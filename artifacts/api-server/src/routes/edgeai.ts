/**
 * POST /screener/sessions/import-from-edgeai
 *
 * Fetches EdgeAI's public data.json, extracts SE market setups,
 * and creates a screener session — no copy-paste needed.
 */
import { Router, type IRouter } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { assessEdgeMarket, isValidPublicationTime } from "../lib/edgeaiFreshness";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const router: IRouter = Router();

const EDGEAI_URL = "https://alexgianni777-tech.github.io/edgeai/public/data.json";

function normalizeRate(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function mapSetupToCategory(
  dir: string,
  setupName: string,
): "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST" {
  if (dir === "short") return "WEAKEST";
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
      const resp = await fetch(EDGEAI_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        res.status(502).json({ error: `EdgeAI fetch failed: ${resp.status}` });
        return;
      }
      edgeData = await resp.json();
    } catch (err: any) {
      res.status(502).json({ error: `Could not reach EdgeAI: ${err.message}` });
      return;
    }

    // Validate the Swedish session BEFORE writing any session.
    // The creation timestamp may be Saturday for Friday's completed data.
    // A force-reimport must never bypass freshness validation.
    const generatedAt = edgeData?.generatedAt;
    if (!isValidPublicationTime(generatedAt)) {
      res.status(422).json({ error: "EdgeAI publication timestamp invalid or in the future" });
      return;
    }
    // AG Invest trades ONLY underlying OMXS30 shares. Never import US ideas.
    const marketStatus = { SE: assessEdgeMarket("SE", edgeData?.markets?.SE) };
    const eligibleKeys = marketStatus.SE.fresh ? ["SE"] : [];
    if (!eligibleKeys.length) {
      res.status(422).json({
        error: "EdgeAI saknar verifierad data från senaste avslutade handelsdag. Import stoppad.",
        marketStatus,
      });
      return;
    }
    const se = edgeData?.markets?.SE;
    // Only import proposals from a market with a verified completed session.
    if (edgeData?.strategyScope !== "OMXS30_ONLY") {
      res.status(422).json({ error: "EdgeAI är inte verifierad som OMXS30_ONLY. Import stoppad." });
      return;
    }
    const allSetups: any[] = marketStatus.SE.fresh && Array.isArray(se?.setups) ? se.setups : [];
    // A Swedish market label alone is insufficient; foreign symbols fail closed.
    if (allSetups.some(s => typeof s?.ticker !== "string" || !/^[A-Z0-9-]+\.ST$/i.test(s.ticker))) {
      res.status(422).json({ error: "Minst en kandidat saknar verifierat svenskt aktietickerformat. Import stoppad." });
      return;
    }
    if (!allSetups.length) {
      res.status(422).json({
        error: "Ingen aktuell och verifierad EdgeAI-signal finns att importera.",
        marketStatus,
      });
      return;
    }
    // Date of the underlying completed market close, never generatedAt.
    const sessionDate = marketStatus.SE.actual as string;
    const primaryMarket = se;

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
        // Compute Wilder RSI(14) from daily closes rather than returning a placeholder zero.
        if (history.length >= 15) {
          const closes = history.map((bar) => bar.close);
          let gains = 0, losses = 0;
          for (let i = 1; i <= 14; i++) {
            const change = closes[i] - closes[i - 1];
            gains += Math.max(change, 0);
            losses += Math.max(-change, 0);
          }
          let avgGain = gains / 14, avgLoss = losses / 14;
          for (let i = 15; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            avgGain = (avgGain * 13 + Math.max(change, 0)) / 14;
            avgLoss = (avgLoss * 13 + Math.max(-change, 0)) / 14;
          }
          marketRsi = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
        }
        if (history.length >= 6)  perf5d  = ((omxsValue - history[history.length - 6].close)  / history[history.length - 6].close)  * 100;
        if (history.length >= 22) perf1m  = ((omxsValue - history[history.length - 22].close) / history[history.length - 22].close) * 100;
        if (history.length >= 64) perf3m  = ((omxsValue - history[history.length - 64].close) / history[history.length - 64].close) * 100;
      }
    } catch {
      // non-fatal — market weather stays 0 if Yahoo Finance is unavailable
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

    // 4. Map verified SE setups only, group by category for ranking
    const rankCounter: Record<string, number> = {};

    const mappedSetups = allSetups.map((s: any) => {
      const category = mapSetupToCategory(s.dir, s.setup ?? "");
      rankCounter[category] = (rankCounter[category] ?? 0) + 1;
      const direction = s.dir === "short" ? "SHORT" : "LONG";
      const entry = Number(s.entry ?? 0);
      const stop = Number(s.stop ?? 0);
      const target = Number(s.target ?? 0);
      const oneR = Math.abs(entry - stop);
      // Strip .ST for display; all source setups must be SE symbols.
      // resolveYahooTicker() maps stored SE symbols back to exchange symbols.
      const ticker = String(s.ticker ?? "").replace(/\.ST$/i, "").toUpperCase();
      // barsAgo: how many bars (trading days) ago the signal was first triggered
      const barsAgo = Number(s.barsAgo ?? 0);
      return {
        category,
        rank: rankCounter[category],
        ticker,
        price: entry,
        rs3m: Number(s.rs ?? 0),
        perf1m: normalizeRate(s.edge?.winRate), // decimal 0-1 for frontend + analytics
        rsi: Number(s.edge?.expectancyR ?? 0) * 100, // store expectancyR × 100 for display
        pctB: Number(s.edge?.sample ?? 0),           // store N (sample size)
        atr: oneR,
        volMultiplier: Number(s.rr ?? 0),  // store actual R/R from EdgeAI
        distFrom20dH: barsAgo,             // store signal age in trading days
        // Reuse the legacy soft-warning field for EdgeAI evidence tier:
        // null = VALIDATED/A, -0.5 = PROMISING/B, -1 = WATCH.
        gapWarning:
          String(s.grade ?? "").toUpperCase() === "A"
            ? null
            : String(s.grade ?? "").toUpperCase() === "B"
              ? -0.5
              : -1,
        direction,
        entryPrice: entry,
        stopPrice: stop,
        targetPrice: target,
        rr: Number(s.rr ?? 0),
        oneR,
        outcome: "PENDING" as const,
        origin: "edgeai",
      };
    });

    // 5. Handle force re-import atomically so a failed insert can never
    // leave a half-empty session.
    const sessionId = await db.transaction(async (tx) => {
      if (existing.length > 0 && force) {
        const existingId = existing[0].id;
        const existingCands = await tx
          .select({
            ticker: candidatesTable.ticker,
            category: candidatesTable.category,
            direction: candidatesTable.direction,
            outcome: candidatesTable.outcome,
            exitPrice: candidatesTable.exitPrice,
            outcomeNotes: candidatesTable.outcomeNotes,
            origin: candidatesTable.origin,
          })
          .from(candidatesTable)
          .where(eq(candidatesTable.sessionId, existingId));

        // Preserve independently by ticker + direction + category.
        const outcomeMap = new Map(
          existingCands
            .filter((cand) => cand.outcome !== "PENDING" && (cand.origin === "edgeai" || cand.origin == null))
            .map((cand) => [
              `${cand.ticker}|${cand.direction}|${cand.category}`,
              cand,
            ]),
        );

        await tx
          .delete(candidatesTable)
          .where(
            and(
              eq(candidatesTable.sessionId, existingId),
              or(eq(candidatesTable.origin, "edgeai"), isNull(candidatesTable.origin)),
            ),
          );

        const [updated] = await tx
          .update(screenerSessionsTable)
          .set({
            trendLabel: primaryMarket.regime?.label ?? "n/a",
            rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt} · SE dataAsOf ${marketStatus.SE.actual ?? "n/a"}`,
            omxsValue,
            perf5d,
            perf1m,
            perf3m,
            marketRsi,
            source: "edgeai",
            edgeRegime: JSON.stringify(primaryMarket.regime ?? {}),
            edgeExpectancy: primaryMarket.edge?.expectancyR ?? null,
            edgeWinRate: normalizeRate(primaryMarket.edge?.winRate),
            edgePF: primaryMarket.edge?.profitFactor ?? null,
            edgeN: primaryMarket.edge?.n ?? null,
          })
          .where(eq(screenerSessionsTable.id, existingId))
          .returning();

        await tx.insert(candidatesTable).values(
          mappedSetups.map((cand) => {
            const prev = outcomeMap.get(
              `${cand.ticker}|${cand.direction}|${cand.category}`,
            );
            return {
              ...cand,
              sessionId: updated.id,
              outcome: prev?.outcome ?? "PENDING",
              exitPrice: prev?.exitPrice ?? null,
              outcomeNotes: prev?.outcomeNotes ?? null,
            } as any;
          }),
        );

        return updated.id;
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
          trendLabel: primaryMarket.regime?.label ?? "n/a",
          rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt} · SE dataAsOf ${marketStatus.SE.actual ?? "n/a"}`,
          source: "edgeai",
          edgeRegime: JSON.stringify(primaryMarket.regime ?? {}),
          edgeExpectancy: primaryMarket.edge?.expectancyR ?? null,
          edgeWinRate: normalizeRate(primaryMarket.edge?.winRate),
          edgePF: primaryMarket.edge?.profitFactor ?? null,
          edgeN: primaryMarket.edge?.n ?? null,
        })
        .returning();

      await tx.insert(candidatesTable).values(
        mappedSetups.map((cand) => ({ ...cand, sessionId: inserted.id } as any)),
      );

      return inserted.id;
    });

    res.status(existing.length > 0 && force ? 200 : 201).json({
      id: sessionId,
      date: sessionDate,
      setupCount: mappedSetups.length,
      generatedAt: edgeData.generatedAt,
      regime: primaryMarket.regime,
      marketStatus,
      includedMarkets: eligibleKeys,
    });
  },
);

export default router;
