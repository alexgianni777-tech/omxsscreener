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
import {
  calculateOpeningGapPct,
  calculateWilderRsi,
  volumeMultiplierFromQuote,
} from "../lib/marketIndicators";
import {
  edgeAiDirection,
  edgeAiSessionDate,
  EdgeAiDataFreshnessError,
  fetchFreshEdgeAiData,
} from "../lib/edgeAiSource";
import { calendarDaysUntil } from "../lib/marketCalendar";
import { logger } from "../lib/logger";
import {
  assertUniqueCandidateIdentities,
  lockScreenerSession,
  synchronizeCandidates,
} from "../lib/candidateSynchronization";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const router: IRouter = Router();

function daysUntil(date: Date | number | null | undefined): number | null {
  return calendarDaysUntil(date);
}

function mapSetupToCategory(
  direction: "LONG" | "SHORT",
  setupName: string,
): "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST" {
  if (direction === "SHORT") return "WEAKEST";
  const n = setupName.toLowerCase();
  if (n.includes("squeeze") || n.includes("bollinger") || n.includes("reversion") || n.includes("mean"))
    return "SQUEEZE";
  if (n.includes("pullback") || n.includes("stud") || n.includes("reversal"))
    return "STUDS";
  return "MOMENTUM"; // breakout, momentum, flag, trend, default
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
      const history = await yf.historical("^OMX", {
        period1: ninetyFiveDaysAgo,
        period2: now,
        interval: "1d",
      }) as Array<{ close: number }>;
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

    // 3. Check for existing session (respect force flag)
    const force = req.body?.force === true;
    const existing = await db
      .select({ id: screenerSessionsTable.id })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.date, sessionDate));

    if (existing.length > 0 && !force) {
      // Return same 409 shape as the regular import endpoint
      const existingId = existing[0].id;
      const affectedOutcomes = await db
        .select({
          ticker: candidatesTable.ticker,
          category: candidatesTable.category,
          outcome: candidatesTable.outcome,
          exitPrice: candidatesTable.exitPrice,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, existingId))
        .then((rows) => rows.filter((r) => r.outcome !== "PENDING"));

      res.status(409).json({
        error: `A session for ${sessionDate} already exists`,
        sessionId: existingId,
        date: sessionDate,
        affectedOutcomes,
      });
      return;
    }

    // 4. Map setups → candidates (SE + US combined), group by category for ranking
    //    Tag each setup with its market BEFORE combining so the market column is populated.
    const usRaw: any[] = edgeData?.markets?.US?.setups ?? [];
    const taggedSetups = [
      ...setups.map((s: any) => ({ ...s, _market: "SE" as const })),
      ...usRaw.map((s: any) => ({ ...s, _market: "US" as const })),
    ];
    const rankCounter: Record<string, number> = {};

    const mappedSetups = taggedSetups.map((s: any) => {
      const direction = edgeAiDirection(s.dir);
      const category = mapSetupToCategory(direction, s.setup ?? "");
      rankCounter[category] = (rankCounter[category] ?? 0) + 1;
      const entry = Number(s.entry ?? 0);
      const stop = Number(s.stop ?? 0);
      const target = Number(s.target ?? 0);
      const oneR = Math.abs(entry - stop);
      // Strip .ST so SE tickers are stored as base form (ALFA, ERIC-B).
      // US tickers have no .ST so stripping is a no-op (AMD stays AMD).
      // resolveYahooTicker() re-adds .ST for SE tickers via SE_BASE_TICKERS / hyphen rule.
      const ticker = String(s.ticker ?? "").replace(/\.ST$/i, "").toUpperCase();
      // barsAgo: how many bars (trading days) ago the signal was first triggered
      const barsAgo = Number(s.barsAgo ?? 0);
      const chart = Array.isArray(s.chart) ? s.chart : [];
      const signalRsi = calculateWilderRsi(chart.map((bar: any) => Number(bar?.c)));
      const signalGapPct = calculateOpeningGapPct(chart);
      return {
        market: s._market,                 // "SE" or "US" — drives the market split in today.tsx
        category,
        rank: rankCounter[category],
        ticker,
        price: entry,
        rs3m: Number(s.rs ?? 0),
        // Normalize to decimal 0–1 (EdgeAI may send integer % like 51)
        perf1m: (() => { const wr = Number(s.edge?.winRate ?? 0); return wr > 1 ? wr / 100 : wr; })(), // store winRate here for per-candidate display
        rsi: Number(s.edge?.expectancyR ?? 0) * 100, // store expectancyR × 100 for display
        pctB: Number(s.edge?.sample ?? 0),           // store N (sample size)
        atr: oneR,
        volMultiplier: 0,  // filled in by live Yahoo Finance fetch below
        earningsInDays: null as number | null,
        distFrom20dH: barsAgo,             // store signal age in trading days
        signalRsi,
        signalGapPct,
        gapWarning: signalGapPct != null && Math.abs(signalGapPct) >= 2.5 ? signalGapPct : null,
        direction,
        entryPrice: entry,
        stopPrice: stop,
        targetPrice: target,
        rr: Number(s.rr ?? 0),
        oneR,
        outcome: "PENDING" as const,
      };
    });
    try {
      assertUniqueCandidateIdentities(mappedSetups);
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "Duplicate EdgeAI setups" });
      return;
    }

    // 5. Enrich volume. Missing Yahoo fields stay at 0 but are logged and are
    //    presented as "saknas", never as a silently valid 0,0x metric.
    await Promise.allSettled(
      mappedSetups.map(async (c) => {
        try {
          const q = (await yf.quote(resolveYahooTicker(c.ticker), {}, { validateResult: false })) as any;
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
          })
          .where(eq(screenerSessionsTable.id, existingId))
          .returning();
        await synchronizeCandidates(tx, updated.id, mappedSetups);
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
        await synchronizeCandidates(tx, inserted.id, mappedSetups);
        return inserted.id;
      });
    }

    res.status(existing.length > 0 && force ? 200 : 201).json({
      id: sessionId,
      date: sessionDate,
      setupCount: mappedSetups.length,
      generatedAt: edgeData.generatedAt,
      regime: se.regime,
    });
  },
);

export default router;
