import { Router, type IRouter } from "express";
import { sql, eq, and, ne } from "drizzle-orm";
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

  res.json(
    GetDashboardSummaryResponse.parse({
      totalSessions,
      totalCandidates,
      resolvedTrades,
      wins,
      losses,
      overallWinRate,
      byCategory,
    })
  );
});

export default router;
