/**
 * Daily EdgeAI auto-import scheduler.
 *
 * Logic:
 *  - Every 5 minutes, check if today is a weekday AND EdgeAI is not yet in today's session.
 *  - If conditions met AND Nasdaq Stockholm is open, trigger EdgeAI import.
 *  - This gracefully handles server restarts: if the server came up after
 *    09:00 Stockholm time and no session exists, it imports immediately.
 */
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "./omxs30TickerMap";
import { fetchOmxsMarketWeather } from "./omxsMarketWeather";
import { completedVolumeKey, fetchCompletedVolumeBatch } from "./completedVolumeBatch";
import { edgeAiSessionDate, fetchFreshEdgeAiData } from "./edgeAiSource";
import {
  lockScreenerSession,
  mergeCandidateInputs,
  synchronizeCandidates,
} from "./candidateSynchronization";
import { aggregateSessionSource } from "./candidateSynchronizationPolicy";
import { snapshotNewSessionTop3 } from "./top3SelectionPolicy";
import { calendarDaysUntil } from "./marketCalendar";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { withRetry } from "./retry";

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

async function sessionHasEdgeAiForDate(date: string): Promise<boolean> {
  const [session] = await db
    .select({ id: screenerSessionsTable.id })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.date, date));
  if (!session) return false;
  const [edgeAiCandidate] = await db
    .select({ id: candidatesTable.id })
    .from(candidatesTable)
    .where(and(
      eq(candidatesTable.sessionId, session.id),
      eq(candidatesTable.signalSource, "edgeai"),
      eq(candidatesTable.signalDate, date),
    ))
    .limit(1);
  return Boolean(edgeAiCandidate);
}

async function runImport(date: string): Promise<void> {
  logger.info({ date }, "[scheduler] Fetching EdgeAI data.json");

  const edgeData = await fetchFreshEdgeAiData(15_000);
  const signalDate = edgeAiSessionDate(edgeData);

  const se = edgeData?.markets?.SE;
  const seSetups: any[] = se?.setups ?? [];
  const usSetups: any[] = edgeData?.markets?.US?.setups ?? [];
  const allSetups = [...seSetups, ...usSetups];

  if (allSetups.length === 0) {
    logger.info({ date, generatedAt: edgeData.generatedAt }, "[scheduler] No setups today — skipping");
    return;
  }

  // The SE data date may be yesterday even when EdgeAI was generated today.
  // Do not replace that completed index bar with today's partial quote.
  const mw = seSetups.length > 0
    ? await fetchOmxsMarketWeather(yf, String(se?.dataAsOf ?? ""))
    : { omxsValue: 0, perf5d: 0, perf1m: 0, perf3m: 0, marketRsi: 0 };

  const rankCounterSE: Record<string, number> = {};
  const rankCounterUS: Record<string, number> = {};
  const seMapped = seSetups.map((s) => mapEdgeAiSetup(s, "SE", rankCounterSE));
  const usMapped = usSetups.map((s) => mapEdgeAiSetup(s, "US", rankCounterUS));
  const mapped = [...seMapped, ...usMapped];
  mapped.forEach((candidate) => {
    Object.assign(candidate, { signalSource: "edgeai" as const, origin: "edgeai" as const, signalDate });
  });

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
        if (isSignalDay) {
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
    await db.transaction(async (tx) => {
      await lockScreenerSession(tx, date);
      const [alreadyStored] = await tx
        .select({ id: screenerSessionsTable.id, source: screenerSessionsTable.source })
        .from(screenerSessionsTable)
        .where(eq(screenerSessionsTable.date, date));
      if (alreadyStored) {
        const existingCandidates = await tx
          .select()
          .from(candidatesTable)
          .where(eq(candidatesTable.sessionId, alreadyStored.id));
        const { candidates: synchronizedCandidates, diff } = await synchronizeCandidates(
          tx,
          alreadyStored.id,
          mergeCandidateInputs(
            mapped,
            existingCandidates.map(({ id, createdAt, ...candidate }) => candidate),
          ),
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
        await snapshotNewSessionTop3(
          tx,
          { id: alreadyStored.id, date, source },
          mapped,
          undefined, ["edgeai"],
        );
        logger.info(
          { date, sessionId: alreadyStored.id, seSetups: seSetups.length, usSetups: usSetups.length },
          "[scheduler] EdgeAI merged into existing session",
        );
        return;
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

      const { candidates: insertedCandidates } = await synchronizeCandidates(tx, inserted.id, mapped);
      await snapshotNewSessionTop3(
        tx,
        { id: inserted.id, date, source: "edgeai" },
        mapped,
        undefined, ["edgeai"],
      );
      // Fresh insert: nothing existed before, so a diff would be all-"added" noise — skip it.
      logger.info(
        { date, sessionId: inserted.id, seSetups: seSetups.length, usSetups: usSetups.length, omxsValue: mw.omxsValue },
        "[scheduler] Auto-import complete",
      );
    });
  } catch (err: any) {
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
    await snapshotNewSessionTop3(tx, { ...session, date }, [], now);
  });
}



let tickInFlight = false;

async function tick() {
  if (tickInFlight) {
    logger.warn("[scheduler] Skipping overlapping tick");
    return;
  }
  tickInFlight = true;
  try {
  const now = new Date();
  schedulerStatus.lastChecked = now.toISOString();

  const stockholm = stockholmClock(now);
    try {
      await evaluateTop3Cutoff(stockholm.date, now);
    } catch (err: any) {
      schedulerStatus.lastError = err.message ?? String(err);
      logger.warn({ err: err.message }, "[scheduler] Top 3 source-readiness evaluation failed");
    }
  if (stockholm.weekday === "Sat" || stockholm.weekday === "Sun") return;

  // ── Daily import (Mon–Fri from 09:00 Europe/Stockholm) ──────────────────────
  const marketIsOpen =
    stockholm.hour > 9 || (stockholm.hour === 9 && stockholm.minute >= 0);
  if (marketIsOpen) {
    const today = stockholm.date;
    if (!(await sessionHasEdgeAiForDate(today))) {
      logger.info({ today }, "[scheduler] EdgeAI missing from today's session — importing");
      try {
        await runImport(today);
        schedulerStatus.lastImported = today;
        schedulerStatus.lastError = null;
      } catch (err: any) {
        schedulerStatus.lastError = err.message ?? String(err);
        logger.warn({ err: err.message }, "[scheduler] Auto-import failed");
      }
    }
  }
  } finally {
    tickInFlight = false;
  }
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
