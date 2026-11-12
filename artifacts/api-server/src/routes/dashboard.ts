import { Router, type IRouter } from "express";
import { sql, eq, inArray } from "drizzle-orm";
import { db, candidatesTable, screenerSessionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { resolveTradePerformance } from "../lib/tradePerformance.ts";

const router: IRouter = Router();

// GET /dashboard/summary
router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  // Total sessions
  const [sessionCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(screenerSessionsTable);
  const totalSessions = Number(sessionCountRow?.count ?? 0);

  let wins = 0;
  let losses = 0;
  let resolvedTrades = 0;

  const categoryMap: Record<
    string,
    { total: number; resolved: number; wins: number; losses: number; skips: number; pending: number }
  > = {};

  // All-candidate performance is intentionally distinct from the retrospectively
  // selected Top3 population. Keep count aggregation in SQL rather than loading
  // every still-pending candidate just to count it.
  const categoryCounts = await db
    .select({
      category: candidatesTable.category,
      outcome: candidatesTable.outcome,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(candidatesTable)
    .groupBy(candidatesTable.category, candidatesTable.outcome);
  let totalCandidates = 0;
  for (const row of categoryCounts) {
    const count = Number(row.count);
    totalCandidates += count;
    const stats = categoryMap[row.category] ??= {
      total: 0, resolved: 0, wins: 0, losses: 0, skips: 0, pending: 0,
    };
    stats.total += count;
    if (row.outcome === "SKIP") stats.skips += count;
    if (row.outcome === "PENDING") stats.pending += count;
  }

  const resolvedRows = await db
    .select({
      category: candidatesTable.category,
      ticker: candidatesTable.ticker,
      outcome: candidatesTable.outcome,
      direction: candidatesTable.direction,
      entryPrice: candidatesTable.entryPrice,
      stopPrice: candidatesTable.stopPrice,
      exitPrice: candidatesTable.exitPrice,
      realizedR: candidatesTable.realizedR,
      resolutionEntryPrice: candidatesTable.resolutionEntryPrice,
      resolutionStopPrice: candidatesTable.resolutionStopPrice,
      resolutionDirection: candidatesTable.resolutionDirection,
      sessionDate: screenerSessionsTable.date,
    })
    .from(candidatesTable)
    .innerJoin(screenerSessionsTable, eq(candidatesTable.sessionId, screenerSessionsTable.id))
    .where(inArray(candidatesTable.outcome, ["WIN", "LOSS", "TIME_EXIT"]))
    .orderBy(screenerSessionsTable.date, candidatesTable.id);

  // Calculate R for each trade: R = signed gain / |entry - stop|
  interface TradeR {
    r: number;
    date: string;
    ticker: string;
    outcome: "WIN" | "LOSS" | "TIME_EXIT";
    result: "WIN" | "LOSS" | "FLAT";
  }
  const tradeRs: TradeR[] = [];

  for (const row of resolvedRows) {
    const performance = resolveTradePerformance(row);
    if (!performance) continue;

    const stats = categoryMap[row.category];
    resolvedTrades++;
    stats.resolved++;
    if (performance.result === "WIN") {
      wins++;
      stats.wins++;
    } else if (performance.result === "LOSS") {
      losses++;
      stats.losses++;
    }
    tradeRs.push({
      r: performance.r,
      date: row.sessionDate,
      ticker: row.ticker,
      outcome: row.outcome as TradeR["outcome"],
      result: performance.result,
    });
  }
  const overallWinRate = resolvedTrades > 0 ? wins / resolvedTrades : null;

  const allCategories = ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] as const;
  const byCategory = allCategories.map((cat) => {
    const stats = categoryMap[cat] ?? { total: 0, resolved: 0, wins: 0, losses: 0, skips: 0, pending: 0 };
    return {
      category: cat,
      total: stats.total,
      wins: stats.wins,
      losses: stats.losses,
      skips: stats.skips,
      pending: stats.pending,
      winRate: stats.resolved > 0 ? stats.wins / stats.resolved : null,
    };
  });

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
  const winRs = tradeRs.filter((t) => t.result === "WIN").map((t) => t.r);
  const lossRs = tradeRs.filter((t) => t.result === "LOSS").map((t) => t.r);

  const avgRWin =
    winRs.length > 0 ? winRs.reduce((a, b) => a + b, 0) / winRs.length : null;
  const avgRLoss =
    lossRs.length > 0 ? lossRs.reduce((a, b) => a + b, 0) / lossRs.length : null;

  const payoffRatio =
    avgRWin != null && avgRLoss != null && avgRLoss !== 0
      ? avgRWin / Math.abs(avgRLoss)
      : null;

  const expectedValue = tradeRs.length > 0
    ? tradeRs.reduce((sum, trade) => sum + trade.r, 0) / tradeRs.length
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
