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

    const se = edgeData?.markets?.SE;
    if (!se) {
      res.status(502).json({ error: "EdgeAI response missing SE market data" });
      return;
    }

    const setups: any[] = se.setups ?? [];

    // 2. Derive proposal-session date from generatedAt. The proposals are
    // intentionally based on the latest completed close and used today.
    const generatedAt = String(edgeData.generatedAt ?? "");
    if (!generatedAt || Number.isNaN(new Date(generatedAt).getTime())) {
      res.status(502).json({ error: "EdgeAI response has invalid generatedAt" });
      return;
    }
    const sessionDate = generatedAt.slice(0, 10);

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

    // 4. Map setups → candidates (SE + US combined), group by category for ranking
    const usSetups: any[] = edgeData?.markets?.US?.setups ?? [];
    const allSetups = [...setups, ...usSetups];
    if (allSetups.length === 0) {
      res.status(422).json({
        error: "EdgeAI has no SE or US proposals in the current generated file.",
        generatedAt: edgeData.generatedAt,
      });
      return;
    }
    const rankCounter: Record<string, number> = {};

    const mappedSetups = allSetups.map((s: any) => {
      const category = mapSetupToCategory(s.dir, s.setup ?? "");
      rankCounter[category] = (rankCounter[category] ?? 0) + 1;
      const direction = s.dir === "short" ? "SHORT" : "LONG";
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
            trendLabel: se.regime?.label ?? "n/a",
            rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt} · SE dataAsOf ${se.dataAsOf ?? "n/a"} · US dataAsOf ${edgeData?.markets?.US?.dataAsOf ?? "n/a"}`,
            omxsValue,
            perf5d,
            perf1m,
            perf3m,
            marketRsi,
            source: "edgeai",
            edgeRegime: JSON.stringify(se.regime ?? {}),
            edgeExpectancy: se.edge?.expectancyR ?? null,
            edgeWinRate: normalizeRate(se.edge?.winRate),
            edgePF: se.edge?.profitFactor ?? null,
            edgeN: se.edge?.n ?? null,
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
          trendLabel: se.regime?.label ?? "n/a",
          rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt} · SE dataAsOf ${se.dataAsOf ?? "n/a"} · US dataAsOf ${edgeData?.markets?.US?.dataAsOf ?? "n/a"}`,
          source: "edgeai",
          edgeRegime: JSON.stringify(se.regime ?? {}),
          edgeExpectancy: se.edge?.expectancyR ?? null,
          edgeWinRate: normalizeRate(se.edge?.winRate),
          edgePF: se.edge?.profitFactor ?? null,
          edgeN: se.edge?.n ?? null,
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
      regime: se.regime,
    });
  },
);

export default router;
