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
import {
  calculateProductPnl,
  countUnderlyingDirections,
  inferOwnedLeveragedProductSide,
} from "../lib/portfolioSemantics";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

type QuoteInfo = { livePrice: number | null; changePct: number | null; asOf: string | null };

async function fetchQuotes(tickers: string[]): Promise<Map<string, QuoteInfo>> {
  const map = new Map<string, QuoteInfo>();
  await Promise.allSettled(
    [...new Set(tickers)].map(async (ticker) => {
      try {
        const q = await yf.quote(resolveYahooTicker(ticker), {}, { validateResult: false }) as any;
        const marketTime: Date | null = q.regularMarketTime ?? null;
        map.set(ticker, {
          livePrice: q.regularMarketPrice ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          asOf: marketTime instanceof Date ? marketTime.toISOString() : null,
        });
      } catch {
        map.set(ticker, { livePrice: null, changePct: null, asOf: null });
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

  const fetchedAt = new Date().toISOString();

  if (positions.length === 0) {
    res.json({
      positions: [],
      summary: {
        count: 0,
        totalInvestedKr: 0,
        totalMarketValueKr: 0,
        totalUnrealisedKr: 0,
        totalUnrealisedPct: 0,
        maxStopLossKr: 0,
        longExposureKr: 0,
        shortExposureKr: 0,
        grossExposureKr: 0,
        netExposureKr: 0,
        underlyingLongCount: 0,
        underlyingShortCount: 0,
        underlyingDirectionUnknownCount: 0,
      },
      fetchedAt,
    });
    return;
  }

  const quoteMap = await fetchQuotes(
    positions.filter((p) => !p.instrument && !p.productType).map((p) => p.ticker),
  );

  const enriched = positions.map((p) => {
    const q = quoteMap.get(p.ticker) ?? { livePrice: null, changePct: null, asOf: null };
    const isProduct = p.instrument != null || p.productType != null;
    const live = isProduct ? (p.lastPrice ?? null) : q.livePrice;
    const changePct = isProduct ? null : q.changePct;
    // Instruments (leveraged products) are priced from the broker's last pasted
    // export, not a live feed — there is no market timestamp for those.
    const quoteAsOf = isProduct ? null : q.asOf;

    const effectiveProductSide = p.productSide ?? inferOwnedLeveragedProductSide(p.instrument) ?? p.direction;
    const isShort = effectiveProductSide === "SHORT";
    const risk1R = p.stopPrice != null ? Math.abs(p.entryPrice - p.stopPrice) : null;
    // Stop P&L is signed and applies to every valid stop, including
    // break-even, profit-locking, and trailing stops.
    const stopPnlKr = p.stopPrice != null
      ? (isShort ? p.entryPrice - p.stopPrice : p.stopPrice - p.entryPrice) * p.shares
      : null;
    const stopPnlPct = p.stopPrice != null
      ? (isShort ? p.entryPrice - p.stopPrice : p.stopPrice - p.entryPrice) / p.entryPrice * 100
      : null;
    // Only a stop on the loss side is a protective stop. Do not present a
    // profit-locking or incorrectly placed stop as a maximum potential loss.
    const hasProtectiveStop = stopPnlKr != null && stopPnlKr < 0;
    const riskToStopKr = hasProtectiveStop ? Math.abs(p.entryPrice - p.stopPrice!) * p.shares : null;
    const riskToStopPct = hasProtectiveStop
      ? (Math.abs(p.entryPrice - p.stopPrice!) / p.entryPrice) * 100
      : null;

    // Unrealised P&L
    let unrealisedPct: number | null = null;
    let unrealisedKr: number | null = null;
    let currentR: number | null = null;
    let distToStop: number | null = null;
    let distToTarget: number | null = null;

    if (live != null) {
      const pnl = calculateProductPnl(p.entryPrice, live, p.shares, p.productSide, p.direction, p.instrument);
      unrealisedPct = pnl.unrealisedPct;
      unrealisedKr = pnl.unrealisedKr;
      const priceDelta = (pnl.unrealisedKr ?? 0) / p.shares;
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
      productType: p.productType ?? null,
      productSide: p.productSide ?? null,
      underlyingDirection: p.underlyingDirection ?? null,
      underlyingTicker: p.underlyingTicker ?? null,
      indicativeLeverage: p.indicativeLeverage ?? null,
      financingLevel: p.financingLevel ?? null,
      barrierLevel: p.barrierLevel ?? null,
      barrierType: p.barrierType ?? null,
      market: p.market ?? null,
      notes: p.notes ?? null,
      entryPrice: p.entryPrice,
      lastPrice: p.lastPrice ?? null,
      stopPrice: p.stopPrice ?? null,
      targetPrice: p.targetPrice ?? null,
      shares: p.shares,
      positionSizeKr,
      risk1R: risk1R != null ? risk1R * p.shares : null,
      riskToStopKr: riskToStopKr != null ? +riskToStopKr.toFixed(0) : null,
      riskToStopPct: riskToStopPct != null ? +riskToStopPct.toFixed(2) : null,
      stopPnlKr: stopPnlKr != null ? +stopPnlKr.toFixed(0) : null,
      stopPnlPct: stopPnlPct != null ? +stopPnlPct.toFixed(2) : null,
      createdAt: p.createdAt,
      livePrice: live,
      changePct,
      quoteAsOf,
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
  const hasPositionWithoutStop = enriched.some((position) => position.stopPrice == null);
  const maxStopLossKr = hasPositionWithoutStop
    ? null
    : enriched.reduce(
        (sum, position) => sum + Math.max(0, -(position.stopPnlKr ?? 0)),
        0,
      );
  const longExposureKr = enriched
    .filter((p) => p.direction === "LONG")
    .reduce((s, p) => s + (p.marketValueKr ?? p.positionSizeKr), 0);
  const shortExposureKr = enriched
    .filter((p) => p.direction === "SHORT")
    .reduce((s, p) => s + (p.marketValueKr ?? p.positionSizeKr), 0);
  const underlyingDirectionCounts = countUnderlyingDirections(positions.map((p) => p.underlyingDirection));

  res.json({
    positions: enriched,
    summary: {
      count: enriched.length,
      totalInvestedKr: +totalInvestedKr.toFixed(0),
      totalMarketValueKr: +totalMarketValueKr.toFixed(0),
      totalUnrealisedKr: +totalUnrealisedKr.toFixed(0),
      totalUnrealisedPct: totalInvestedKr > 0 ? +((totalUnrealisedKr / totalInvestedKr) * 100).toFixed(2) : 0,
      maxStopLossKr: maxStopLossKr != null ? +maxStopLossKr.toFixed(0) : null,
      longExposureKr: +longExposureKr.toFixed(0),
      shortExposureKr: +shortExposureKr.toFixed(0),
      grossExposureKr: +(longExposureKr + shortExposureKr).toFixed(0),
      netExposureKr: +(longExposureKr - shortExposureKr).toFixed(0),
      ...underlyingDirectionCounts,
    },
    fetchedAt,
  });
});

// POST /portfolio  — add position
router.post("/portfolio", async (req, res): Promise<void> => {
  const {
    ticker, instrument, direction, productType, productSide, underlyingDirection, underlyingTicker,
    indicativeLeverage, financingLevel, barrierLevel, barrierType,
    entryPrice, shares, stopPrice, targetPrice, market, notes,
  } = req.body ?? {};
  if (
    typeof ticker !== "string" || !ticker.trim() ||
    !["LONG", "SHORT"].includes(direction) ||
    typeof entryPrice !== "number" || !isFinite(entryPrice) || entryPrice <= 0 ||
    typeof shares !== "number" || !isFinite(shares) || shares <= 0
  ) {
    res.status(400).json({ error: "Ogiltiga fält: ticker, direction, entryPrice och shares krävs." });
    return;
  }
  if ((productSide != null && !["LONG", "SHORT"].includes(productSide)) ||
      (underlyingDirection != null && !["LONG", "SHORT"].includes(underlyingDirection))) {
    res.status(400).json({ error: "Ogiltig produkt- eller underliggande riktning." });
    return;
  }
  for (const [name, value] of Object.entries({ indicativeLeverage, financingLevel, barrierLevel })) {
    if (value != null && (typeof value !== "number" || !isFinite(value) || value <= 0)) {
      res.status(400).json({ error: `Ogiltigt värde för ${name}.` });
      return;
    }
  }
  const [pos] = await db
    .insert(openPositionsTable)
    .values({
      ticker: ticker.trim().toUpperCase(),
      instrument: typeof instrument === "string" && instrument.trim() ? instrument.trim() : null,
      direction,
      productType: typeof productType === "string" && productType.trim() ? productType.trim() : null,
      productSide: productSide ?? null,
      underlyingDirection: underlyingDirection ?? null,
      underlyingTicker: typeof underlyingTicker === "string" && underlyingTicker.trim() ? underlyingTicker.trim().toUpperCase() : null,
      indicativeLeverage: indicativeLeverage ?? null,
      financingLevel: financingLevel ?? null,
      barrierLevel: barrierLevel ?? null,
      barrierType: typeof barrierType === "string" && barrierType.trim() ? barrierType.trim() : null,
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

// PATCH /portfolio/:id — edit an existing open position in place (no delete + re-add).
router.patch("/portfolio/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Ogiltigt id" }); return; }

  const [existing] = await db.select().from(openPositionsTable).where(eq(openPositionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Position hittades inte" }); return; }

  const {
    ticker, instrument, direction, productType, productSide, underlyingDirection, underlyingTicker,
    indicativeLeverage, financingLevel, barrierLevel, barrierType,
    entryPrice, shares, stopPrice, targetPrice, market, notes,
  } = req.body ?? {};
  const updates: Partial<typeof openPositionsTable.$inferInsert> = {};

  if (ticker !== undefined) {
    if (typeof ticker !== "string" || !ticker.trim()) { res.status(400).json({ error: "Ogiltig ticker." }); return; }
    updates.ticker = ticker.trim().toUpperCase();
  }
  if (instrument !== undefined) {
    updates.instrument = typeof instrument === "string" && instrument.trim() ? instrument.trim() : null;
  }
  if (direction !== undefined) {
    if (!["LONG", "SHORT"].includes(direction)) { res.status(400).json({ error: "Ogiltig riktning." }); return; }
    updates.direction = direction;
  }
  if (productType !== undefined) {
    updates.productType = typeof productType === "string" && productType.trim() ? productType.trim() : null;
  }
  for (const [field, value] of [["productSide", productSide], ["underlyingDirection", underlyingDirection]] as const) {
    if (value !== undefined) {
      if (value !== null && !["LONG", "SHORT"].includes(value)) {
        res.status(400).json({ error: "Ogiltig produkt- eller underliggande riktning." });
        return;
      }
      updates[field] = value;
    }
  }
  if (underlyingTicker !== undefined) {
    updates.underlyingTicker = typeof underlyingTicker === "string" && underlyingTicker.trim()
      ? underlyingTicker.trim().toUpperCase()
      : null;
  }
  for (const [field, value] of [["indicativeLeverage", indicativeLeverage], ["financingLevel", financingLevel], ["barrierLevel", barrierLevel]] as const) {
    if (value !== undefined) {
      if (value !== null && (typeof value !== "number" || !isFinite(value) || value <= 0)) {
        res.status(400).json({ error: `Ogiltigt värde för ${field}.` });
        return;
      }
      updates[field] = value;
    }
  }
  if (barrierType !== undefined) {
    updates.barrierType = typeof barrierType === "string" && barrierType.trim() ? barrierType.trim() : null;
  }
  if (entryPrice !== undefined) {
    if (typeof entryPrice !== "number" || !isFinite(entryPrice) || entryPrice <= 0) { res.status(400).json({ error: "Ogiltigt entry-pris." }); return; }
    updates.entryPrice = entryPrice;
  }
  if (shares !== undefined) {
    if (typeof shares !== "number" || !isFinite(shares) || shares <= 0) { res.status(400).json({ error: "Ogiltigt antal aktier." }); return; }
    updates.shares = shares;
  }
  if (stopPrice !== undefined) {
    updates.stopPrice = typeof stopPrice === "number" && isFinite(stopPrice) && stopPrice > 0 ? stopPrice : null;
  }
  if (targetPrice !== undefined) {
    updates.targetPrice = typeof targetPrice === "number" && isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null;
  }
  if (market !== undefined) {
    updates.market = typeof market === "string" && market ? market.toUpperCase() : null;
  }
  if (notes !== undefined) {
    updates.notes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Inga fält att uppdatera." });
    return;
  }

  const [updated] = await db
    .update(openPositionsTable)
    .set(updates)
    .where(eq(openPositionsTable.id, id))
    .returning();
  res.json(updated);
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
    productSide: "LONG" | "SHORT" | null;
    underlyingDirection: "LONG" | "SHORT" | null;
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
    for (const [field, value] of [["productSide", entry.productSide], ["underlyingDirection", entry.underlyingDirection]] as const) {
      if (value !== undefined && value !== null && !["LONG", "SHORT"].includes(value)) {
        res.status(400).json({ error: `Ogiltig riktning för ${field}.` });
        return;
      }
    }
    validEntries.push({
      ticker: entry.ticker.trim().toUpperCase(),
      instrument: entry.instrument.trim(),
      direction: entry.direction,
      productSide: entry.productSide ?? inferOwnedLeveragedProductSide(entry.instrument.trim()),
      underlyingDirection: entry.underlyingDirection ?? null,
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
          productSide: entry.productSide ?? match.productSide,
          underlyingDirection: entry.underlyingDirection ?? match.underlyingDirection,
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
          productSide: entry.productSide,
          underlyingDirection: entry.underlyingDirection,
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
