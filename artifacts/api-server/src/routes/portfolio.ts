/**
 * GET /api/portfolio
 *
 * Returns all open positions enriched with live Yahoo Finance quotes.
 * Each position is extended with:
 *   - livePrice, changePct
 *   - unrealised P&L in SEK and as a percentage
 *   - current R multiple (how many R the trade is currently up/down)
 *   - distance to stop (%) and distance to target (%)
 */
import { Router, type IRouter } from "express";
import { db, openPositionsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

async function fetchQuotes(tickers: string[]): Promise<Map<string, { livePrice: number | null; changePct: number | null }>> {
  const map = new Map<string, { livePrice: number | null; changePct: number | null }>();
  await Promise.allSettled(
    [...new Set(tickers)].map(async (ticker) => {
      try {
        const q = await yf.quote(resolveYahooTicker(ticker), {}, { validateResult: false }) as any;
        map.set(ticker, {
          livePrice: q.regularMarketPrice ?? null,
          changePct: q.regularMarketChangePercent ?? null,
        });
      } catch {
        map.set(ticker, { livePrice: null, changePct: null });
      }
    }),
  );
  return map;
}

router.get("/portfolio", async (_req, res): Promise<void> => {
  const positions = await db
    .select()
    .from(openPositionsTable)
    .orderBy(asc(openPositionsTable.createdAt));

  if (positions.length === 0) {
    res.json({ positions: [], summary: { totalUnrealisedKr: 0, totalMarketValueKr: 0 } });
    return;
  }

  const quoteMap = await fetchQuotes(positions.map((p) => p.ticker));

  const enriched = positions.map((p) => {
    const q = quoteMap.get(p.ticker) ?? { livePrice: null, changePct: null };
    const live = q.livePrice;

    const isShort = p.direction === "SHORT";
    const risk1R = p.stopPrice != null ? Math.abs(p.entryPrice - p.stopPrice) : null;

    // Unrealised P&L
    let unrealisedPct: number | null = null;
    let unrealisedKr: number | null = null;
    let currentR: number | null = null;
    let distToStop: number | null = null;
    let distToTarget: number | null = null;

    if (live != null) {
      const priceDelta = isShort ? p.entryPrice - live : live - p.entryPrice;
      unrealisedPct = (priceDelta / p.entryPrice) * 100;
      unrealisedKr = priceDelta * p.shares;
      if (risk1R != null && risk1R > 0) currentR = priceDelta / risk1R;

      if (p.stopPrice != null) {
        distToStop = isShort
          ? ((p.stopPrice - live) / live) * 100   // how far above live price stop is
          : ((live - p.stopPrice) / live) * 100;  // how far below live price stop is
      }
      if (p.targetPrice != null) {
        distToTarget = isShort
          ? ((live - p.targetPrice) / live) * 100  // how far to fall to target
          : ((p.targetPrice - live) / live) * 100; // how far to rise to target
      }
    }

    const positionSizeKr = p.entryPrice * p.shares;
    const marketValueKr = live != null ? live * p.shares : null;

    return {
      id: p.id,
      ticker: p.ticker,
      direction: p.direction,
      market: p.market ?? null,
      notes: p.notes ?? null,
      entryPrice: p.entryPrice,
      stopPrice: p.stopPrice ?? null,
      targetPrice: p.targetPrice ?? null,
      shares: p.shares,
      positionSizeKr,
      risk1R: risk1R != null ? risk1R * p.shares : null,
      createdAt: p.createdAt,
      livePrice: live,
      changePct: q.changePct,
      unrealisedPct: unrealisedPct != null ? +unrealisedPct.toFixed(2) : null,
      unrealisedKr: unrealisedKr != null ? +unrealisedKr.toFixed(0) : null,
      currentR: currentR != null ? +currentR.toFixed(2) : null,
      marketValueKr,
      distToStop: distToStop != null ? +distToStop.toFixed(2) : null,
      distToTarget: distToTarget != null ? +distToTarget.toFixed(2) : null,
    };
  });

  const totalUnrealisedKr = enriched.reduce((s, p) => s + (p.unrealisedKr ?? 0), 0);
  const totalMarketValueKr = enriched.reduce((s, p) => s + (p.marketValueKr ?? p.positionSizeKr), 0);
  const totalInvestedKr = enriched.reduce((s, p) => s + p.positionSizeKr, 0);

  res.json({
    positions: enriched,
    summary: {
      count: enriched.length,
      totalInvestedKr: +totalInvestedKr.toFixed(0),
      totalMarketValueKr: +totalMarketValueKr.toFixed(0),
      totalUnrealisedKr: +totalUnrealisedKr.toFixed(0),
      totalUnrealisedPct: totalInvestedKr > 0 ? +((totalUnrealisedKr / totalInvestedKr) * 100).toFixed(2) : 0,
    },
  });
});

// POST /portfolio  — add position
router.post("/portfolio", async (req, res): Promise<void> => {
  const { ticker, direction, entryPrice, shares, stopPrice, targetPrice, market, notes } = req.body ?? {};
  if (
    typeof ticker !== "string" || !ticker.trim() ||
    !["LONG", "SHORT"].includes(direction) ||
    typeof entryPrice !== "number" || !isFinite(entryPrice) || entryPrice <= 0 ||
    typeof shares !== "number" || !isFinite(shares) || shares <= 0
  ) {
    res.status(400).json({ error: "Ogiltiga fält: ticker, direction, entryPrice och shares krävs." });
    return;
  }
  const [pos] = await db
    .insert(openPositionsTable)
    .values({
      ticker: ticker.trim().toUpperCase(),
      direction,
      entryPrice,
      shares,
      stopPrice: typeof stopPrice === "number" && isFinite(stopPrice) && stopPrice > 0 ? stopPrice : null,
      targetPrice: typeof targetPrice === "number" && isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null,
      market: typeof market === "string" && market ? market.toUpperCase() : null,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    })
    .returning();
  res.status(201).json(pos);
});

// DELETE /portfolio/:id
router.delete("/portfolio/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Ogiltigt id" }); return; }
  const [deleted] = await db
    .delete(openPositionsTable)
    .where(eq(openPositionsTable.id, id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Position hittades inte" }); return; }
  res.sendStatus(204);
});

export default router;
