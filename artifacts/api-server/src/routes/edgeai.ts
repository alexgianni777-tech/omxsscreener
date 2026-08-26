/**
 * POST /screener/sessions/import-from-edgeai
 *
 * Fetches EdgeAI's public data.json, extracts SE market setups,
 * and creates a screener session — no copy-paste needed.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";
import { calculateWilderRsi, volumeMultiplierFromQuote } from "../lib/marketIndicators";
import {
  edgeAiSessionDate,
  EdgeAiDataFreshnessError,
  fetchFreshEdgeAiData,
} from "../lib/edgeAiSource";
import { calendarDaysUntil } from "../lib/marketCalendar";
import { logger } from "../lib/logger";
import { withRetry } from "../lib/retry";
import {
  candidateIdentity,
  deduplicateCandidates,
  lockScreenerSession,
  mergeCandidateInputs,
  synchronizeCandidates,
} from "../lib/candidateSynchronization";
import { mapEdgeAiSetup } from "../lib/edgeAiMapping";

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
      edgeData = await fetchFreshEdgeAiData(10_000);
    } catch (err: any) {
      if (err instanceof EdgeAiDataFreshnessError) {
        res.status(422).json({ error: err.message, generatedAt: err.generatedAt });
        return;
      }
      res.status(502).json({ error: `Could not reach EdgeAI: ${err.message}` });
      return;
    }

    const se = edgeData?.markets?.SE;
    if (!se) {
      res.status(502).json({ error: "EdgeAI response missing SE market data" });
      return;
    }

    const setups: any[] = se.setups ?? [];
    if (setups.length === 0) {
      res.status(422).json({
        error: "EdgeAI has no SE setups today — screener may not have run yet.",
        generatedAt: edgeData.generatedAt,
      });
      return;
    }

    // The stored session date is the verified EdgeAI signal day, never the
    // browser/server clock. fetchFreshEdgeAiData has already required today.
    const sessionDate = edgeAiSessionDate(edgeData);

    // 2b. Fetch real OMXS30 market weather from Yahoo Finance
    let omxsValue = 0, perf5d = 0, perf1m = 0, perf3m = 0, marketRsi = 0;
    try {
      const now = new Date();
      const ninetyFiveDaysAgo = new Date(now.getTime() - 95 * 86_400_000);
      const history = await withRetry(() => yf.historical("^OMX", {
        period1: ninetyFiveDaysAgo,
        period2: now,
        interval: "1d",
      })) as Array<{ close: number }>;
      if (history.length > 0) {
        omxsValue = history[history.length - 1].close;
        if (history.length >= 6)  perf5d  = ((omxsValue - history[history.length - 6].close)  / history[history.length - 6].close)  * 100;
        if (history.length >= 22) perf1m  = ((omxsValue - history[history.length - 22].close) / history[history.length - 22].close) * 100;
        if (history.length >= 64) perf3m  = ((omxsValue - history[history.length - 64].close) / history[history.length - 64].close) * 100;
        marketRsi = calculateWilderRsi(history.map((bar) => Number(bar.close))) ?? 0;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Manual EdgeAI import could not calculate OMXS30 weather");
    }

    // 3. Map setups → candidates (SE + US combined), rank each market separately.
    //    mapEdgeAiSetup is the single shared mapping function (see edgeAiMapping.ts) —
    //    also used by the scheduler auto-import, so both paths stay in sync. Computed
    //    up front (pure, no I/O) so the 409 conflict check below can preview exactly
    //    which pending candidates a force re-import would remove.
    const usRaw: any[] = edgeData?.markets?.US?.setups ?? [];
    const rankCounter: Record<string, number> = {};
    const mappedSetups = [
      ...setups.map((s: any) => mapEdgeAiSetup(s, "SE", rankCounter)),
      ...usRaw.map((s: any) => mapEdgeAiSetup(s, "US", rankCounter)),
    ];
    const { candidates: uniqueMappedSetups, skipped } = deduplicateCandidates(mappedSetups);
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
          ticker: candidatesTable.ticker,
          category: candidatesTable.category,
          direction: candidatesTable.direction,
          market: candidatesTable.market,
          outcome: candidatesTable.outcome,
          exitPrice: candidatesTable.exitPrice,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, existingId));

      const affectedOutcomes = existingRows.filter((r) => r.outcome !== "PENDING");

      const incomingIdentities = new Set(uniqueMappedSetups.map((c) => candidateIdentity(c as any)));
      const wouldRemove = existingRows
        .filter((r) => r.outcome === "PENDING" && !incomingIdentities.has(candidateIdentity(r as any)))
        .map(({ ticker, category, direction, market }) => ({ ticker, category, direction, market: market ?? "SE" }));

      res.status(409).json({
        error: `A session for ${sessionDate} already exists`,
        sessionId: existingId,
        date: sessionDate,
        affectedOutcomes,
        wouldRemove,
      });
      return;
    }

    const existingCandidates =
      existing.length > 0 && force
        ? await db
            .select()
            .from(candidatesTable)
            .where(eq(candidatesTable.sessionId, existing[0].id))
        : [];

    // 5. Enrich volume. Missing Yahoo fields stay at 0 but are logged and are
    //    presented as "saknas", never as a silently valid 0,0x metric.
    await Promise.allSettled(
      uniqueMappedSetups.map(async (c) => {
        try {
          const q = (await withRetry(() => yf.quote(resolveYahooTicker(c.ticker), {}, { validateResult: false }))) as any;
          const volumeMultiplier = volumeMultiplierFromQuote(q);
          if (volumeMultiplier != null) {
            c.volMultiplier = volumeMultiplier;
          } else {
            logger.warn({ ticker: c.ticker }, "Volume enrichment missing Yahoo volume or average fields");
          }
          c.earningsInDays = daysUntil(q.earningsTimestamp);
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
            source: existing[0].source === "edgeai" ? "edgeai" : "mixed",
          })
          .where(eq(screenerSessionsTable.id, existingId))
          .returning();
        const { diff } = await synchronizeCandidates(
          tx,
          updated.id,
          mergeCandidateInputs(
            uniqueMappedSetups,
            existingCandidates.map(({ id, createdAt, ...candidate }) => candidate),
          ),
        );
        await tx
          .update(screenerSessionsTable)
          .set({ lastImportDiff: diff, lastImportAt: new Date() })
          .where(eq(screenerSessionsTable.id, updated.id));
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
        await synchronizeCandidates(tx, inserted.id, uniqueMappedSetups);
        // Fresh insert: nothing existed before, so a diff would be all-"added" noise — skip it.
        return inserted.id;
      });
    }

    res.status(existing.length > 0 && force ? 200 : 201).json({
      id: sessionId,
      date: sessionDate,
      setupCount: uniqueMappedSetups.length,
      generatedAt: edgeData.generatedAt,
      regime: se.regime,
    });
  },
);

export default router;
