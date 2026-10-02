/**
 * POST /screener/sessions/import-from-edgeai
 *
 * Fetches EdgeAI's public data.json, extracts SE market setups,
 * and creates a screener session — no copy-paste needed.
 */
import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  screenerSessionsTable,
  candidatesTable,
  top3SelectionSnapshotsTable,
  survivalTradesTable,
} from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";
import { fetchOmxsMarketWeather } from "../lib/omxsMarketWeather";
import { completedVolumeKey, fetchCompletedVolumeBatch } from "../lib/completedVolumeBatch";
import {
  edgeAiSessionDate,
  edgeAiDataFreshness,
  EdgeAiDataFreshnessError,
  fetchFreshEdgeAiData,
} from "../lib/edgeAiSource";
import { calendarDaysUntil } from "../lib/marketCalendar";
import { logger } from "../lib/logger";
import { withRetry } from "../lib/retry";
import {
  deduplicateCandidates,
  lockScreenerSession,
  mergeCandidateInputs,
  pendingCandidatesToRemove,
  synchronizeCandidates,
  candidateIdentity,
} from "../lib/candidateSynchronization";
import { mapEdgeAiSetup } from "../lib/edgeAiMapping";
import { aggregateSessionSource } from "../lib/candidateSynchronizationPolicy";
import { snapshotNewSessionTop3 } from "../lib/top3SelectionPolicy";
import { stockholmSignalDate } from "../lib/signalDatePolicy";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const router: IRouter = Router();

function daysUntil(date: Date | number | null | undefined): number | null {
  return calendarDaysUntil(date);
}

router.post(
  "/screener/sessions/import-from-edgeai",
  async (req, res): Promise<void> => {
    // 1. Fetch latest EdgeAI data
    let edgeData: any;
    try {
      // Manual and scheduled imports share the same one-previous-close limit.
      edgeData = await fetchFreshEdgeAiData(10_000);
    } catch (err: any) {
      if (err instanceof EdgeAiDataFreshnessError) {
        res.status(422).json({ error: err.message, generatedAt: err.generatedAt });
        return;
      }
      res.status(502).json({ error: `Could not reach EdgeAI: ${err.message}` });
      return;
    }

    const markets = edgeData?.markets;
    const se = markets?.SE ?? {};
    const us = markets?.US ?? {};
    if (!markets || (!markets.SE && !markets.US)) {
      res.status(502).json({ error: "EdgeAI response missing SE market data" });
      return;
    }

    const setups: any[] = Array.isArray(se.setups) ? se.setups : [];
    const usRaw: any[] = Array.isArray(us.setups) ? us.setups : [];
    if (setups.length === 0 && usRaw.length === 0) {
      res.status(422).json({
        error: "EdgeAI has no SE or US setups in the latest snapshot.",
        generatedAt: edgeData.generatedAt,
      });
      return;
    }

    // The stored session date is the EdgeAI signal day, never the browser/server
    // clock. A manual import may intentionally use the latest prior trading day.
    const signalDate = edgeAiSessionDate(edgeData);
    const sessionDate = stockholmSignalDate();
    const freshness = edgeAiDataFreshness(edgeData);

    // EdgeAI generated today can still use yesterday's completed market bars.
    // Keep index context on the SE data day, never the partial import-day bar.
    let mw;
    try {
      mw = setups.length > 0
        ? await fetchOmxsMarketWeather(yf, String(se.dataAsOf ?? ""))
        : { omxsValue: 0, perf5d: 0, perf1m: 0, perf3m: 0, marketRsi: 0 };
    } catch (err: any) {
      logger.warn({ err: err.message }, "Manual EdgeAI import could not verify completed OMXS30 weather");
      res.status(502).json({ error: "Stängd OMXS30-kurs för EdgeAI:s datadag saknas. Försök igen när kursdata finns." });
      return;
    }
    const { omxsValue, perf5d, perf1m, perf3m, marketRsi } = mw;

    // 3. Map setups → candidates (SE + US combined), rank each market separately.
    //    mapEdgeAiSetup is the single shared mapping function (see edgeAiMapping.ts) —
    //    also used by the scheduler auto-import, so both paths stay in sync. Computed
    //    up front (pure, no I/O) so the 409 conflict check below can preview exactly
    //    which pending candidates a force re-import would remove.
    const rankCounter: Record<string, number> = {};
    const mappedSetups = [
      ...setups.map((s: any) => mapEdgeAiSetup(s, "SE", rankCounter)),
      ...usRaw.map((s: any) => mapEdgeAiSetup(s, "US", rankCounter)),
    ];
    const { candidates: uniqueMappedSetups, skipped } = deduplicateCandidates(mappedSetups);
    uniqueMappedSetups.forEach((candidate) => {
      Object.assign(candidate, { signalSource: "edgeai" as const, origin: "edgeai" as const, signalDate });
    });
    if (skipped.length > 0) {
      logger.warn({ skipped }, "EdgeAI import skipped duplicate candidate identities");
    }

    // 4. Check for existing session (respect force flag)
    const force = req.body?.force === true;
    const existing = await db
      .select({ id: screenerSessionsTable.id, source: screenerSessionsTable.source })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.date, sessionDate));

    if (existing.length > 0 && !force) {
      // Return same 409 shape as the regular import endpoint
      const existingId = existing[0].id;
      const existingRows = await db
        .select({
          id: candidatesTable.id,
          ticker: candidatesTable.ticker,
          category: candidatesTable.category,
          direction: candidatesTable.direction,
          market: candidatesTable.market,
          signalSource: candidatesTable.signalSource,
          outcome: candidatesTable.outcome,
          exitPrice: candidatesTable.exitPrice,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, existingId));

      const affectedOutcomes = existingRows.filter((r) => r.outcome !== "PENDING");

      // Preview the exact effective input used by the force path. In
      // particular, candidates from a separate market or source are retained.
      const selectedSnapshotRows = await db
        .select({ candidateId: top3SelectionSnapshotsTable.candidateId })
        .from(top3SelectionSnapshotsTable)
        .where(and(
          eq(top3SelectionSnapshotsTable.sessionId, existingId),
          eq(top3SelectionSnapshotsTable.selected, true),
        ));
      const linkedTrades = existingRows.length ? await db
        .select({ candidateId: survivalTradesTable.sourceCandidateId })
        .from(survivalTradesTable)
        .where(inArray(survivalTradesTable.sourceCandidateId, existingRows.map((row) => row.id))) : [];
      const wouldRemove = pendingCandidatesToRemove(
        existingRows,
        uniqueMappedSetups,
        new Set([
          ...selectedSnapshotRows.map((row) => row.candidateId),
          ...linkedTrades.map((row) => row.candidateId!),
        ]),
      );

      res.status(409).json({
        error: `A session for ${sessionDate} already exists`,
        sessionId: existingId,
        date: sessionDate,
        affectedOutcomes,
        wouldRemove,
      });
      return;
    }

    if (existing.length > 0 && force) {
      const existingRows = await db
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, existing[0].id));
      const incomingByIdentity = new Map(
        uniqueMappedSetups.map((candidate) => [candidateIdentity(candidate), signalDate] as const),
      );
      const mismatch = existingRows.find((candidate) =>
        candidate.signalDate != null &&
        incomingByIdentity.has(candidateIdentity(candidate)) &&
        incomingByIdentity.get(candidateIdentity(candidate)) !== candidate.signalDate,
      );
      if (mismatch) {
        res.status(409).json({
          error: `Signal date mismatch for ${mismatch.ticker}: stored ${mismatch.signalDate}, incoming ${signalDate}`,
        });
        return;
      }
    }

    // Use the completed market-data day that produced the signal, not today's
    // partial live quote or the (possibly later) session/import date.
    const volumeRequests = uniqueMappedSetups.map((c) => ({
      ticker: c.ticker,
      market: c.market,
      asOfDate: String((c.market === "SE" ? se : us).dataAsOf ?? ""),
    }));
    const volumeMap = await fetchCompletedVolumeBatch(yf, volumeRequests);
    uniqueMappedSetups.forEach((c, index) => {
      const request = volumeRequests[index];
      const value = request.asOfDate <= signalDate ? volumeMap.get(completedVolumeKey(request)) : null;
      if (value) {
        c.volMultiplier = value.multiplier;
        c.volumeAsOf = value.asOf;
      }
    });
    // Earnings calendar remains signal-time evidence only on the actual
    // import day; it does not reconstruct historical observations.
    await Promise.allSettled(
      uniqueMappedSetups.map(async (c) => {
        try {
          const isSignalDay = signalDate === stockholmCalendarDate();
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
          logger.warn({ ticker: c.ticker, err: err.message }, "Volume enrichment failed");
        }
      }),
    );

    // 6. Handle force re-import: preserve existing outcomes
    let sessionId: number;

    if (existing.length > 0 && force) {
      const existingId = existing[0].id;
      sessionId = await db.transaction(async (tx) => {
        await lockScreenerSession(tx, sessionDate);
        const existingCandidates = await tx
          .select()
          .from(candidatesTable)
          .where(eq(candidatesTable.sessionId, existingId));
        const [updated] = await tx
          .update(screenerSessionsTable)
          .set({
            trendLabel: se.regime?.label ?? "n/a",
            rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt}`,
            omxsValue,
            perf5d,
            perf1m,
            perf3m,
            marketRsi,
          })
          .where(eq(screenerSessionsTable.id, existingId))
          .returning();
        const { candidates: synchronizedCandidates, diff } = await synchronizeCandidates(
          tx,
          updated.id,
          mergeCandidateInputs(
            uniqueMappedSetups,
            existingCandidates.map(({ id, createdAt, ...candidate }) => candidate),
          ),
        );
        const aggregateSource = aggregateSessionSource(
          existing[0].source,
          synchronizedCandidates.map((candidate) => candidate.signalSource),
        );
        await tx
          .update(screenerSessionsTable)
          .set({ lastImportDiff: diff, lastImportAt: new Date(), source: aggregateSource })
          .where(eq(screenerSessionsTable.id, updated.id));
        await snapshotNewSessionTop3(
          tx,
          { id: updated.id, date: sessionDate, source: aggregateSource },
          uniqueMappedSetups,
          undefined, ["edgeai"],
        );
        return updated.id;
      });
    } else {
      // Fresh insert
      sessionId = await db.transaction(async (tx) => {
        await lockScreenerSession(tx, sessionDate);
        const [alreadyStored] = await tx
          .select({ id: screenerSessionsTable.id })
          .from(screenerSessionsTable)
          .where(eq(screenerSessionsTable.date, sessionDate));
        if (alreadyStored) {
          throw new Error(`A session for ${sessionDate} already exists; refresh and use force to synchronize it`);
        }
        const [inserted] = await tx
          .insert(screenerSessionsTable)
          .values({
            date: sessionDate,
            omxsValue,
            perf5d,
            perf1m,
            perf3m,
            marketRsi,
            trendLabel: se.regime?.label ?? "n/a",
            rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt}`,
            source: "edgeai",
            edgeRegime: JSON.stringify(se.regime ?? {}),
            edgeExpectancy: se.edge?.expectancyR ?? null,
            edgeWinRate: se.edge?.winRate != null
              ? (se.edge.winRate > 1 ? se.edge.winRate / 100 : se.edge.winRate)
              : null,
            edgePF: se.edge?.profitFactor ?? null,
            edgeN: se.edge?.n ?? null,
          })
          .returning();
        const { candidates: insertedCandidates } = await synchronizeCandidates(tx, inserted.id, uniqueMappedSetups);
        await snapshotNewSessionTop3(
          tx,
          { id: inserted.id, date: sessionDate, source: "edgeai" },
          uniqueMappedSetups,
          undefined, ["edgeai"],
        );
        // Fresh insert: nothing existed before, so a diff would be all-"added" noise — skip it.
        return inserted.id;
      });
    }

    res.status(existing.length > 0 && force ? 200 : 201).json({
      id: sessionId,
      date: sessionDate,
      setupCount: uniqueMappedSetups.length,
      generatedAt: edgeData.generatedAt,
      stale: freshness.isDifferentUtcDate || freshness.ageMs > 30 * 60 * 60 * 1_000,
      ageDescription: freshness.ageDescription,
      regime: se.regime,
    });
  },
);

export default router;

function stockholmCalendarDate(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
