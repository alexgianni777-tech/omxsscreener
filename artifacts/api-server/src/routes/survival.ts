/**
 * /survival — Survival Challenge Tracker
 *
 * GET  /survival           → { config, trades, stats }
 * PATCH /survival/config   → update startCapital / goalCapital
 * POST /survival/trades    → add trade
 * DELETE /survival/trades/:id → remove trade
 */
import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, survivalConfigTable, survivalTradesTable, openPositionsTable } from "@workspace/db";

const router: IRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

async function getOrCreateConfig() {
  const rows = await db.select().from(survivalConfigTable).limit(1);
  if (rows.length) return rows[0];
  const [created] = await db
    .insert(survivalConfigTable)
    .values({ startCapital: 5000, goalCapital: 1000000 })
    .returning();
  return created;
}

function computeStats(startCapital: number, trades: typeof survivalTradesTable.$inferSelect[]) {
  const equity = startCapital + trades.reduce((s, t) => s + t.pnlKr, 0);

  // loss streak at tail
  let currentStreak = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].pnlKr < 0) currentStreak++;
    else break;
  }

  // max streak ever
  let maxStreak = 0;
  let cur = 0;
  for (const t of trades) {
    cur = t.pnlKr < 0 ? cur + 1 : 0;
    maxStreak = Math.max(maxStreak, cur);
  }

  const wins = trades.filter((t) => t.pnlKr > 0);
  const losses = trades.filter((t) => t.pnlKr < 0);
  const planned = trades.filter((t) => t.followedPlan);
  const disciplinePct = trades.length ? Math.round((planned.length / trades.length) * 100) : null;

  const lastStats = (arr: typeof trades) => {
    if (!arr.length) return null;
    const sum = arr.reduce((s, t) => s + t.pnlKr, 0);
    const w = arr.filter((t) => t.pnlKr > 0).length;
    return { n: arr.length, sum, avg: sum / arr.length, winPct: Math.round((w / arr.length) * 100) };
  };

  const lastTrades = trades.filter((t) => t.flag === "LAST");
  const reflexTrades = trades.filter((t) => t.flag === "REFLEX");

  // equity curve: cumulative kr at each trade
  const equityCurve: { i: number; eq: number }[] = [{ i: 0, eq: startCapital }];
  let running = startCapital;
  trades.forEach((t, idx) => {
    running += t.pnlKr;
    equityCurve.push({ i: idx + 1, eq: running });
  });

  return {
    equity,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winPct: trades.length ? Math.round((wins.length / trades.length) * 100) : null,
    currentStreak,
    maxStreak,
    circuitBreakerActive: currentStreak >= 3,
    disciplinePct,
    last: lastStats(lastTrades),
    reflex: lastStats(reflexTrades),
    equityCurve,
  };
}

// ─── routes ─────────────────────────────────────────────────────────────────

// GET /survival
router.get("/survival", async (_req, res): Promise<void> => {
  const config = await getOrCreateConfig();
  const trades = await db
    .select()
    .from(survivalTradesTable)
    .orderBy(asc(survivalTradesTable.createdAt));

  const stats = computeStats(config.startCapital, trades);
  res.json({ config, trades, stats });
});

// PATCH /survival/config
router.patch("/survival/config", async (req, res): Promise<void> => {
  const { startCapital, goalCapital } = req.body ?? {};
  const patch: Partial<{ startCapital: number; goalCapital: number; updatedAt: Date }> = {};
  if (startCapital !== undefined) {
    if (typeof startCapital !== "number" || startCapital <= 0) {
      res.status(400).json({ error: "startCapital must be a positive number" });
      return;
    }
    patch.startCapital = startCapital;
  }
  const { currentCapital } = req.body ?? {};
  if (currentCapital !== undefined) {
    if (currentCapital !== null && (typeof currentCapital !== "number" || !isFinite(currentCapital) || currentCapital < 0)) {
      res.status(400).json({ error: "currentCapital must be a non-negative number or null" });
      return;
    }
    (patch as any).currentCapital = currentCapital;
  }
  if (goalCapital !== undefined) {
    if (typeof goalCapital !== "number" || goalCapital <= 0) {
      res.status(400).json({ error: "goalCapital must be a positive number" });
      return;
    }
    const effectiveStart = patch.startCapital ?? (await getOrCreateConfig()).startCapital;
    if (goalCapital <= effectiveStart) {
      res.status(400).json({ error: "goalCapital must be greater than startCapital" });
      return;
    }
    patch.goalCapital = goalCapital;
  }
  patch.updatedAt = new Date();
  const config = await getOrCreateConfig();
  const [updated] = await db
    .update(survivalConfigTable)
    .set(patch)
    .where(eq(survivalConfigTable.id, config.id))
    .returning();
  res.json(updated);
});

// POST /survival/trades
router.post("/survival/trades", async (req, res): Promise<void> => {
  const { date, ticker, strategy, direction, leverageX, pnlKr, flag, followedPlan } = req.body ?? {};
  if (
    typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof strategy !== "string" || !strategy ||
    !["LONG", "SHORT"].includes(direction) ||
    typeof pnlKr !== "number" || !isFinite(pnlKr) ||
    !["LAST", "REFLEX"].includes(flag) ||
    typeof followedPlan !== "boolean"
  ) {
    res.status(400).json({ error: "Invalid trade payload" });
    return;
  }
  const [trade] = await db
    .insert(survivalTradesTable)
    .values({
      date,
      ticker: ticker ?? null,
      strategy,
      direction,
      leverageX: typeof leverageX === "number" && isFinite(leverageX) ? leverageX : null,
      pnlKr,
      flag,
      followedPlan,
    })
    .returning();
  res.status(201).json(trade);
});

// DELETE /survival/trades/:id
router.delete("/survival/trades/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(survivalTradesTable)
    .where(eq(survivalTradesTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  res.sendStatus(204);
});

// ─── Open Positions ──────────────────────────────────────────────────────────

// GET /survival/positions
router.get("/survival/positions", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(openPositionsTable)
    .orderBy(asc(openPositionsTable.createdAt));
  res.json(rows);
});

// POST /survival/positions
router.post("/survival/positions", async (req, res): Promise<void> => {
  const { ticker, direction, entryPrice, shares, stopPrice } = req.body ?? {};
  if (
    typeof ticker !== "string" || !ticker.trim() ||
    !["LONG", "SHORT"].includes(direction) ||
    typeof entryPrice !== "number" || !isFinite(entryPrice) || entryPrice <= 0 ||
    typeof shares !== "number" || !isFinite(shares) || shares <= 0
  ) {
    res.status(400).json({ error: "Invalid position payload" });
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
    })
    .returning();
  res.status(201).json(pos);
});

// DELETE /survival/positions/:id
router.delete("/survival/positions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db
    .delete(openPositionsTable)
    .where(eq(openPositionsTable.id, id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Position not found" }); return; }
  res.sendStatus(204);
});

export default router;
