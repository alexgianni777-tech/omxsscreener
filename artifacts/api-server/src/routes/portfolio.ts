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

  const quoteMap = await fetchQuotes(positions.filter((p) => !p.instrument).map((p) => p.ticker));

  const enriched = positions.map((p) => {
    const q = quoteMap.get(p.ticker) ?? { livePrice: null, changePct: null };
    const live = p.instrument ? (p.lastPrice ?? null) : q.livePrice;
    const changePct = p.instrument ? null : q.changePct;

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
      instrument: p.instrument ?? null,
      direction: p.direction,
      market: p.market ?? null,
      notes: p.notes ?? null,
      entryPrice: p.entryPrice,
      lastPrice: p.lastPrice ?? null,
      stopPrice: p.stopPrice ?? null,
      targetPrice: p.targetPrice ?? null,
      shares: p.shares,
      positionSizeKr,
      risk1R: risk1R != null ? risk1R * p.shares : null,
      createdAt: p.createdAt,
      livePrice: live,
      changePct,
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
  const { ticker, instrument, direction, entryPrice, shares, stopPrice, targetPrice, market, notes } = req.body ?? {};
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
      instrument: typeof instrument === "string" && instrument.trim() ? instrument.trim() : null,
      direction,
      entryPrice,
      lastPrice: null,
      shares,
      stopPrice: typeof stopPrice === "number" && isFinite(stopPrice) && stopPrice > 0 ? stopPrice : null,
      targetPrice: typeof targetPrice === "number" && isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null,
      market: typeof market === "string" && market ? market.toUpperCase() : null,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    })
    .returning();
  res.status(201).json(pos);
});

// POST /portfolio/import — update positions from a pasted broker export.
// Existing positions are matched by underlying ticker + instrument, so repeating
// an import refreshes the position instead of creating another row.
router.post("/portfolio/import", async (req, res): Promise<void> => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) {
    res.status(400).json({ error: "Minst en och högst 100 positioner krävs." });
    return;
  }

  const validEntries: Array<{
    ticker: string;
    instrument: string;
    direction: "LONG" | "SHORT";
    entryPrice: number;
    lastPrice: number;
    shares: number;
    market: string | null;
  }> = [];

  for (const entry of entries) {
    if (
      typeof entry?.ticker !== "string" || !entry.ticker.trim() ||
      typeof entry?.instrument !== "string" || !entry.instrument.trim() ||
      !["LONG", "SHORT"].includes(entry.direction) ||
      typeof entry?.entryPrice !== "number" || !isFinite(entry.entryPrice) || entry.entryPrice <= 0 ||
      typeof entry?.lastPrice !== "number" || !isFinite(entry.lastPrice) || entry.lastPrice <= 0 ||
      typeof entry?.shares !== "number" || !isFinite(entry.shares) || entry.shares <= 0
    ) {
      res.status(400).json({ error: "Varje importposition måste ha ticker, instrument, riktning, antal, inköpskurs och aktuell kurs." });
      return;
    }
    validEntries.push({
      ticker: entry.ticker.trim().toUpperCase(),
      instrument: entry.instrument.trim(),
      direction: entry.direction,
      entryPrice: entry.entryPrice,
      lastPrice: entry.lastPrice,
      shares: entry.shares,
      market: typeof entry.market === "string" && entry.market.trim() ? entry.market.trim().toUpperCase() : null,
    });
  }

  const existing = await db.select().from(openPositionsTable);
  let created = 0;
  let updated = 0;

  for (const entry of validEntries) {
    const match = existing.find((position) =>
      position.ticker.toUpperCase() === entry.ticker &&
      (position.instrument ?? "").trim().toLowerCase() === entry.instrument.toLowerCase(),
    );

    if (match) {
      await db
        .update(openPositionsTable)
        .set({
          direction: entry.direction,
          entryPrice: entry.entryPrice,
          lastPrice: entry.lastPrice,
          shares: entry.shares,
          market: entry.market ?? match.market,
        })
        .where(eq(openPositionsTable.id, match.id));
      updated++;
    } else {
      const [createdPosition] = await db
        .insert(openPositionsTable)
        .values({
          ticker: entry.ticker,
          instrument: entry.instrument,
          direction: entry.direction,
          entryPrice: entry.entryPrice,
          lastPrice: entry.lastPrice,
          shares: entry.shares,
          market: entry.market,
          stopPrice: null,
          targetPrice: null,
          notes: null,
        })
        .returning();
      existing.push(createdPosition);
      created++;
    }
  }

  res.status(200).json({ created, updated, total: validEntries.length });
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
