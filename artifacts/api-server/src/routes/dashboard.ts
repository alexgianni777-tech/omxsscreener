import { Router, type IRouter } from "express";
import { sql, eq, and, ne, inArray } from "drizzle-orm";
import { db, candidatesTable, screenerSessionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /dashboard/summary
router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  // Total sessions
  const [sessionCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(screenerSessionsTable);
  const totalSessions = Number(sessionCountRow?.count ?? 0);

  // Total candidates and outcome breakdown
  const outcomeRows = await db
    .select({
      outcome: candidatesTable.outcome,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(candidatesTable)
    .groupBy(candidatesTable.outcome);

  let wins = 0;
  let losses = 0;
  let totalCandidates = 0;

  for (const row of outcomeRows) {
    const count = Number(row.count);
    totalCandidates += count;
    if (row.outcome === "WIN") wins = count;
    if (row.outcome === "LOSS") losses = count;
  }

  const resolvedTrades = wins + losses;
  const overallWinRate = resolvedTrades > 0 ? wins / resolvedTrades : null;

  // Per-category stats
  const categoryRows = await db
    .select({
      category: candidatesTable.category,
      outcome: candidatesTable.outcome,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(candidatesTable)
    .groupBy(candidatesTable.category, candidatesTable.outcome);

  const categoryMap: Record<
    string,
    { total: number; wins: number; losses: number; skips: number; pending: number }
  > = {};

  for (const row of categoryRows) {
    const count = Number(row.count);
    if (!categoryMap[row.category]) {
      categoryMap[row.category] = { total: 0, wins: 0, losses: 0, skips: 0, pending: 0 };
    }
    categoryMap[row.category].total += count;
    if (row.outcome === "WIN") categoryMap[row.category].wins += count;
    if (row.outcome === "LOSS") categoryMap[row.category].losses += count;
    if (row.outcome === "SKIP") categoryMap[row.category].skips += count;
    if (row.outcome === "PENDING") categoryMap[row.category].pending += count;
  }

  const allCategories = ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] as const;
  const byCategory = allCategories.map((cat) => {
    const stats = categoryMap[cat] ?? { total: 0, wins: 0, losses: 0, skips: 0, pending: 0 };
    const resolved = stats.wins + stats.losses;
    return {
      category: cat,
      total: stats.total,
      wins: stats.wins,
      losses: stats.losses,
      skips: stats.skips,
      pending: stats.pending,
      winRate: resolved > 0 ? stats.wins / resolved : null,
    };
  });

  // P&L / R-multiple stats — fetch resolved trades with prices, ordered by session date
  const resolvedRows = await db
    .select({
      ticker: candidatesTable.ticker,
      outcome: candidatesTable.outcome,
      direction: candidatesTable.direction,
      entryPrice: candidatesTable.entryPrice,
      stopPrice: candidatesTable.stopPrice,
      exitPrice: candidatesTable.exitPrice,
      sessionDate: screenerSessionsTable.date,
    })
    .from(candidatesTable)
    .innerJoin(screenerSessionsTable, eq(candidatesTable.sessionId, screenerSessionsTable.id))
    .where(inArray(candidatesTable.outcome, ["WIN", "LOSS"]))
    .orderBy(screenerSessionsTable.date, candidatesTable.id);

  // Calculate R for each trade: R = signed gain / |entry - stop|
  interface TradeR {
    r: number;
    date: string;
    ticker: string;
    outcome: "WIN" | "LOSS";
  }
  const tradeRs: TradeR[] = [];

  for (const row of resolvedRows) {
    if (
      row.exitPrice == null ||
      row.entryPrice == null ||
      row.stopPrice == null
    ) {
      continue;
    }
    const oneRUnit = Math.abs(row.entryPrice - row.stopPrice);
    if (oneRUnit === 0) continue;

    let r: number;
    if (row.direction === "LONG") {
      r = (row.exitPrice - row.entryPrice) / oneRUnit;
    } else {
      // SHORT
      r = (row.entryPrice - row.exitPrice) / oneRUnit;
    }

    tradeRs.push({
      r,
      date: row.sessionDate,
      ticker: row.ticker,
      outcome: row.outcome as "WIN" | "LOSS",
    });
  }

  // Equity curve
  let cumulative = 0;
  const equityCurve = tradeRs.map((t, i) => {
    cumulative += t.r;
    return {
      tradeIndex: i + 1,
      cumulativeR: Math.round(cumulative * 1000) / 1000,
      r: Math.round(t.r * 1000) / 1000,
      date: t.date,
      ticker: t.ticker,
      outcome: t.outcome,
    };
  });

  // Aggregate stats
  const winRs = tradeRs.filter((t) => t.outcome === "WIN").map((t) => t.r);
  const lossRs = tradeRs.filter((t) => t.outcome === "LOSS").map((t) => t.r);

  const avgRWin =
    winRs.length > 0 ? winRs.reduce((a, b) => a + b, 0) / winRs.length : null;
  const avgRLoss =
    lossRs.length > 0 ? lossRs.reduce((a, b) => a + b, 0) / lossRs.length : null;

  const payoffRatio =
    avgRWin != null && avgRLoss != null && avgRLoss !== 0
      ? avgRWin / Math.abs(avgRLoss)
      : null;

  // EV is computed from the same exit-priced population as the R stats
  const pricedWins = winRs.length;
  const pricedLosses = lossRs.length;
  const pricedResolved = pricedWins + pricedLosses;
  const pricedWinRate = pricedResolved > 0 ? pricedWins / pricedResolved : null;

  const expectedValue =
    pricedWinRate != null && avgRWin != null && avgRLoss != null
      ? pricedWinRate * avgRWin + (1 - pricedWinRate) * avgRLoss
      : null;

  res.json(
    GetDashboardSummaryResponse.parse({
      totalSessions,
      totalCandidates,
      resolvedTrades,
      wins,
      losses,
      overallWinRate,
      byCategory,
      avgRWin,
      avgRLoss,
      payoffRatio,
      expectedValue,
      equityCurve,
    })
  );
});

export default router;
