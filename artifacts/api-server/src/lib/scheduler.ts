/**
 * Daily EdgeAI auto-import scheduler.
 *
 * Logic:
 *  - Every 5 minutes on weekdays, check the source version before enrichment/import.
 *  - If conditions met AND Nasdaq Stockholm is open, trigger EdgeAI import.
 *  - This gracefully handles server restarts: if the server came up after
 *    09:00 Stockholm time and no session exists, it imports immediately.
 */
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { makeImportReport, ImportDataError } from "./importReport";
import { recordImportFailure } from "./importFailure";
import { respectStoredEdgeAiBackoff, attachFetchDiagnostic } from "./storedSourceBackoff";
import { isolateEdgeAiPlans } from "./edgeAiPlanIsolation";
import { logger } from "./logger";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "./omxs30TickerMap";
import { fetchOmxsMarketWeather } from "./omxsMarketWeather";
import { completedVolumeKey, fetchCompletedVolumeBatch } from "./completedVolumeBatch";
import { edgeAiSessionDate, fetchFreshEdgeAiData } from "./edgeAiSource";
import { AUTOMATIC_EARNINGS_CHECK_ENABLED } from "./screeningReview";
import {
  lockScreenerSession,
  preserveCandidateInputs,
  synchronizeCandidates,
} from "./candidateSynchronization";
import { aggregateSessionSource } from "./candidateSynchronizationPolicy";
import { snapshotNewSessionTop3 } from "./top3SelectionPolicy";
import { calendarDaysUntil } from "./marketCalendar";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { withRetry } from "./retry";
import { alreadyAcceptedReport } from "./scheduledReportPolicy";
import { createImportCheckCoordinator } from "./importCheckCoordinator";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Start at Nasdaq Stockholm's 09:00 local open. An IANA timezone avoids
// summer/winter time shifting the scheduler by an hour.
const STOCKHOLM_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function stockholmClock(d: Date) {
  const parts = Object.fromEntries(
    STOCKHOLM_TIME.formatToParts(d).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function daysUntil(date: Date | number | null | undefined): number | null {
  return calendarDaysUntil(date);
}

// In-memory status — reset on server restart
export let schedulerStatus: {
  lastChecked: string | null;
  lastImported: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
} = {
  lastChecked: null,
  lastImported: null,
  lastError: null,
  nextCheckAt: null,
};

async function sessionHasReport(
  date: string,
  report: ReturnType<typeof makeImportReport>,
  client: Pick<typeof db, "select"> = db,
): Promise<boolean> {
  const sessions = await client
    .select({ sourceReports: screenerSessionsTable.sourceReports })
    .from(screenerSessionsTable)
    .where(inArray(screenerSessionsTable.date, [date, report.signalDate]));
  // D-1 content already accepted on its original day is not a new Monday report.
  return sessions.some(session => alreadyAcceptedReport(session.sourceReports, report, date));
}

async function runImport(date: string): Promise<boolean> {
  logger.info({ date }, "[scheduler] Fetching EdgeAI data.json");

  await respectStoredEdgeAiBackoff();
  const fetched = await fetchFreshEdgeAiData(15_000);
  const edgeData = fetched.data;
  const signalDate = edgeAiSessionDate(edgeData);
  const importReport = makeImportReport("edgeai", signalDate, fetched.rawData, edgeData.generatedAt ?? null, fetched.quality.dataDates);
  importReport.warnings = fetched.quality.warnings;
  importReport.quarantinedIdentities = fetched.quality.quarantinedIdentities;
  if (fetched.quality.errors.length > 0) {
    throw new ImportDataError(`EdgeAI-import avvisad: ${fetched.quality.errors.join(" ")}`, importReport);
  }
  if (await sessionHasReport(date, importReport)) {
    logger.debug({ date, signalDate }, "[scheduler] Accepted report unchanged — no enrichment or reimport");
    return false;
  }

  const se = edgeData?.markets?.SE;
  const seSetups: any[] = se?.setups ?? [];
  const usSetups: any[] = edgeData?.markets?.US?.setups ?? [];
  const allSetups = [...seSetups, ...usSetups];

  if (allSetups.length === 0) {
    throw new ImportDataError("EdgeAI-rapporten innehåller inga setups. Befintliga kandidater lämnades orörda.", importReport);
  }

  // The SE data date may be yesterday even when EdgeAI was generated today.
  // Do not replace that completed index bar with today's partial quote.
  const mw = seSetups.length > 0
    ? await fetchOmxsMarketWeather(yf, String(se?.dataAsOf ?? ""))
    : { omxsValue: 0, perf5d: 0, perf1m: 0, perf3m: 0, marketRsi: 0 };

  const rankCounterSE: Record<string, number> = {};
  const rankCounterUS: Record<string, number> = {};
  const seMapped = seSetups.map((s) => mapEdgeAiSetup(s, "SE", rankCounterSE, fetched.quality.dataDates.SE));
  const usMapped = usSetups.map((s) => mapEdgeAiSetup(s, "US", rankCounterUS, fetched.quality.dataDates.US));
  const allMapped = [...seMapped, ...usMapped];
  allMapped.forEach((candidate) => {
    Object.assign(candidate, { signalSource: "edgeai" as const, origin: "edgeai" as const });
  });
  const mapped = isolateEdgeAiPlans(allMapped, [...seSetups, ...usSetups].map(s => `${s.setup} (${s.signalT ?? "signaltid okänd"})`), importReport);

  const volumeRequests = mapped.map((c) => ({
    ticker: c.ticker,
    market: c.market,
    asOfDate: String((c.market === "SE" ? se : edgeData.markets.US)?.dataAsOf ?? ""),
  }));
  const volumeMap = await fetchCompletedVolumeBatch(yf, volumeRequests);
  mapped.forEach((c, index) => {
    const request = volumeRequests[index];
    const value = request.asOfDate <= signalDate ? volumeMap.get(completedVolumeKey(request)) : null;
    if (value) {
      c.volMultiplier = value.multiplier;
      c.volumeAsOf = value.asOf;
    }
  });

  // Yahoo's current earnings calendar is usable only for today's signal.
  await Promise.allSettled(
    mapped.map(async (c) => {
      try {
        const isSignalDay = date === stockholmClock(new Date()).date && signalDate === date;
        if (AUTOMATIC_EARNINGS_CHECK_ENABLED && isSignalDay) {
          const q = (await withRetry(() => yf.quote(resolveYahooTicker(c.ticker), {}, { validateResult: false }))) as any;
          const earningsInDays = daysUntil(q.earningsTimestamp);
          if (earningsInDays != null) {
            c.earningsInDays = earningsInDays;
            c.earningsKnowledge = "SIGNAL_TIME";
            c.earningsObservedAt = new Date();
          }
        }
      } catch (err: any) {
        logger.warn({ ticker: c.ticker, err: err.message }, "[scheduler] Volume enrichment failed");
      }
    }),
  );

  try {
    const imported = await db.transaction(async (tx) => {
      await lockScreenerSession(tx, date);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"edgeai-report:" + importReport.fingerprint}))`);
      // Another instance may have accepted the report during Yahoo enrichment.
      if (await sessionHasReport(date, importReport, tx)) return false;
      const [alreadyStored] = await tx
        .select({ id: screenerSessionsTable.id, source: screenerSessionsTable.source })
        .from(screenerSessionsTable)
        .where(eq(screenerSessionsTable.date, date));
      if (alreadyStored) {
        const existingCandidates = await tx
          .select()
          .from(candidatesTable)
          .where(eq(candidatesTable.sessionId, alreadyStored.id));
        const { candidates: synchronizedCandidates, diff, duplicateReport } = await synchronizeCandidates(
          tx,
          alreadyStored.id,
      preserveCandidateInputs(
            mapped,
            existingCandidates.map(({ id, createdAt, ...candidate }) => candidate),
          ),
          new Date(), importReport,
        );
        const source = aggregateSessionSource(
          alreadyStored.source,
          synchronizedCandidates.map((candidate) => candidate.signalSource),
        );
        await tx
          .update(screenerSessionsTable)
          .set({
            omxsValue: mw.omxsValue,
            perf5d: mw.perf5d,
            perf1m: mw.perf1m,
            perf3m: mw.perf3m,
            marketRsi: mw.marketRsi,
            trendLabel: se?.regime?.label ?? "n/a",
            edgeRegime: JSON.stringify(se?.regime ?? {}),
            edgeExpectancy: se?.edge?.expectancyR ?? null,
            edgeWinRate: se?.edge?.winRate != null
              ? (se.edge.winRate > 1 ? se.edge.winRate / 100 : se.edge.winRate)
              : null,
            edgePF: se?.edge?.profitFactor ?? null,
            edgeN: se?.edge?.n ?? null,
            source,
            lastImportDiff: diff,
            lastImportAt: new Date(),
          })
          .where(eq(screenerSessionsTable.id, alreadyStored.id));
        if (!duplicateReport) await snapshotNewSessionTop3(
          tx,
          { id: alreadyStored.id, date, source },
          mapped,
          undefined, ["edgeai"], false,
        );
        logger.info(
          { date, sessionId: alreadyStored.id, seSetups: seSetups.length, usSetups: usSetups.length },
          "[scheduler] EdgeAI merged into existing session",
        );
        return !duplicateReport;
      }
      const [inserted] = await tx
        .insert(screenerSessionsTable)
        .values({
        date,
        omxsValue: mw.omxsValue,
        perf5d: mw.perf5d,
        perf1m: mw.perf1m,
        perf3m: mw.perf3m,
        marketRsi: mw.marketRsi,
        trendLabel: se?.regime?.label ?? "n/a",
        rawText: `EdgeAI auto-import — generatedAt ${edgeData.generatedAt}`,
        source: "edgeai",
        edgeRegime: JSON.stringify(se?.regime ?? {}),
        edgeExpectancy: se?.edge?.expectancyR ?? null,
        edgeWinRate: se?.edge?.winRate != null
          ? (se.edge.winRate > 1 ? se.edge.winRate / 100 : se.edge.winRate)
          : null,
        edgePF: se?.edge?.profitFactor ?? null,
        edgeN: se?.edge?.n ?? null,
        })
        .returning();

      const { candidates: insertedCandidates } = await synchronizeCandidates(tx, inserted.id, mapped, new Date(), importReport);
      await snapshotNewSessionTop3(
        tx,
        { id: inserted.id, date, source: "edgeai" },
        mapped,
        undefined, ["edgeai"], false,
      );
      // Fresh insert: nothing existed before, so a diff would be all-"added" noise — skip it.
      logger.info(
        { date, sessionId: inserted.id, seSetups: seSetups.length, usSetups: usSetups.length, omxsValue: mw.omxsValue },
        "[scheduler] Auto-import complete",
      );
      return true;
    });
    return imported;
  } catch (err: any) {
    if (err instanceof ImportDataError && err.report) {
      try { await recordImportFailure(date, err.report, err.message); }
      catch (diagnosticError) { logger.warn({ diagnosticError }, "Import failure could not be recorded"); }
    }
    throw new Error(`DB insert failed: ${err.message}`);
  }
}

async function evaluateTop3Cutoff(date: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await lockScreenerSession(tx, date);
    const [session] = await tx
      .select({ id: screenerSessionsTable.id, source: screenerSessionsTable.source })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.date, date));
    if (!session) return;
    await snapshotNewSessionTop3(tx, { ...session, date }, [], now, [], false);
  });
}



export type EdgeAiCheckResult = {
  status: "IMPORTED" | "UNCHANGED" | "SKIPPED" | "FAILED";
};

async function runCheck(): Promise<EdgeAiCheckResult> {
  const now = new Date();
  schedulerStatus.lastChecked = now.toISOString();

  const stockholm = stockholmClock(now);
    try {
      await evaluateTop3Cutoff(stockholm.date, now);
    } catch (err: any) {
      schedulerStatus.lastError = err.message ?? String(err);
      logger.warn({ err: err.message }, "[scheduler] Top 3 source-readiness evaluation failed");
    }
   if (stockholm.weekday === "Sat" || stockholm.weekday === "Sun") return { status: "SKIPPED" };

  // ── Daily import (Mon–Fri from 09:00 Europe/Stockholm) ──────────────────────
  const marketIsOpen =
    stockholm.hour > 9 || (stockholm.hour === 9 && stockholm.minute >= 0);
  if (marketIsOpen) {
    const today = stockholm.date;
    {
      try {
        const imported = await runImport(today);
        if (imported) schedulerStatus.lastImported = today;
        schedulerStatus.lastError = null;
         return { status: imported ? "IMPORTED" : "UNCHANGED" };
      } catch (err: any) {
        schedulerStatus.lastError = err.message ?? String(err);
        const message = err instanceof Error ? err.message : "EdgeAI auto-import failed";
        const report = err instanceof ImportDataError && err.report
          ? err.report
          : makeImportReport("edgeai", stockholm.date, { failure: message });
        attachFetchDiagnostic(report, err);
        try {
          await recordImportFailure(stockholm.date, report, message);
        } catch (recordError: any) {
          logger.warn({ err: recordError?.message ?? "unknown" }, "[scheduler] Could not record failed import receipt");
        }
        logger.warn({ err: err.message }, "[scheduler] Auto-import failed");
         return { status: "FAILED" };
      }
    }
  }
  return { status: "SKIPPED" };
}

// Shared by startup, existing timer, authenticated page reads and the external
// wake hook. Sharing a pending promise prevents premature webhook success.
export const checkEdgeAiAfterWake = createImportCheckCoordinator(runCheck, CHECK_INTERVAL_MS);
function tick() {
  void checkEdgeAiAfterWake().catch(err => {
    schedulerStatus.lastError = "Import check failed";
    logger.warn({ err: err instanceof Error ? err.message : "unknown" }, "[scheduler] Check failed");
  });
}

export function startScheduler() {
  // This module is process-local, but startScheduler can be called by more
  // than one bootstrap path in tests or hot reloads. Never create two pollers.
  if (schedulerInterval) {
    logger.debug("[scheduler] Already started; ignoring duplicate start");
    return schedulerInterval;
  }
  // Run once on startup (with a short delay to let DB connect)
  setTimeout(() => tick(), 10_000);
  // Then every 5 minutes
  const interval = setInterval(tick, CHECK_INTERVAL_MS);
  schedulerInterval = interval;

  const nextCheck = new Date(Date.now() + CHECK_INTERVAL_MS);
  schedulerStatus.nextCheckAt = nextCheck.toISOString();

  logger.info("[scheduler] Started — checking EdgeAI every 5 min on weekdays from 09:00 Europe/Stockholm; imports as soon as today's data is available");
  return interval;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
