/**
 * GET /api/screener/analytics/top3
 *
 * Hypothetical "top 3 per session" strategy performance.
 * For every session, picks the 3 candidates with the highest edge score
 * (winRate × expectancyR), then tracks their logged outcomes as R-multiples.
 * PENDING outcomes are excluded from running totals.
 */
import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/screener/analytics/top3", async (_req, res): Promise<void> => {
  const sessions = await db
    .select({ id: screenerSessionsTable.id, date: screenerSessionsTable.date })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.source, "edgeai"))
    .orderBy(asc(screenerSessionsTable.date));

  if (sessions.length === 0) {
    res.json({ sessions: [], stats: emptyStats() });
    return;
  }

  const allCandidates = await db.select().from(candidatesTable);

  // Group by session
  const bySession = new Map<number, typeof allCandidates>();
  for (const c of allCandidates) {
    if (!bySession.has(c.sessionId)) bySession.set(c.sessionId, []);
    bySession.get(c.sessionId)!.push(c);
  }

  let cumulativeR = 0;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;

  const sessionResults = sessions.map((session) => {
    const candidates = bySession.get(session.id) ?? [];

    // Rank by E[R] proxy, then keep only one position per ticker.
    const sorted = [...candidates].sort(
      (a, b) =>
        (b.perf1m ?? 0) * ((b.rsi ?? 0) / 100) -
        (a.perf1m ?? 0) * ((a.rsi ?? 0) / 100),
    );

    const top3 = [];
    const seenTickers = new Set<string>();
    for (const candidate of sorted) {
      if (seenTickers.has(candidate.ticker)) continue;
      seenTickers.add(candidate.ticker);
      top3.push(candidate);
      if (top3.length === 3) break;
    }

    const picks = top3.map((candidate) => {
      const risk = Math.abs(
        (candidate.entryPrice ?? 0) - (candidate.stopPrice ?? 0),
      );
      let r: number | null = null;

      if (
        (candidate.outcome === "WIN" || candidate.outcome === "LOSS") &&
        candidate.exitPrice != null &&
        risk > 0
      ) {
        r =
          candidate.direction === "SHORT"
            ? ((candidate.entryPrice ?? 0) - candidate.exitPrice) / risk
            : (candidate.exitPrice - (candidate.entryPrice ?? 0)) / risk;
      }

      return {
        ticker: candidate.ticker,
        direction: candidate.direction,
        edgeScore: Number(
          (((candidate.perf1m ?? 0) * ((candidate.rsi ?? 0) / 100))).toFixed(4),
        ),
        outcome: candidate.outcome,
        r,
      };
    });

    const complete =
      picks.length > 0 &&
      picks.every(
        (pick) =>
          pick.outcome === "SKIP" ||
          ((pick.outcome === "WIN" || pick.outcome === "LOSS") && pick.r != null),
      );

    let sessionR: number | null = null;
    if (complete) {
      sessionR = picks.reduce((sum, pick) => sum + (pick.r ?? 0), 0);
      for (const pick of picks) {
        if (pick.outcome === "WIN" && pick.r != null) {
          wins++;
          totalTrades++;
        } else if (pick.outcome === "LOSS" && pick.r != null) {
          losses++;
          totalTrades++;
        }
      }
      cumulativeR += sessionR;
    }

    return {
      date: session.date,
      sessionId: session.id,
      picks,
      sessionR,
      cumulativeR,
    };
  });

  const winRate = totalTrades > 0 ? wins / totalTrades : null;
  const avgRPerTrade = totalTrades > 0 ? cumulativeR / totalTrades : null;

  res.json({
    sessions: sessionResults,
    stats: {
      totalSessions: sessions.length,
      completedSessions: sessionResults.filter((s) => s.sessionR !== null).length,
      totalTrades,
      wins,
      losses,
      winRate,
      totalR: cumulativeR,
      avgRPerTrade,
    },
  });
});

function emptyStats() {
  return {
    totalSessions: 0,
    completedSessions: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    totalR: 0,
    avgRPerTrade: null,
  };
}

export default router;
