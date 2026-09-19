/**
 * GET /api/screener/analytics/top3
 *
 * Hypothetical "top 3 per session" strategy performance.
 * For every session, picks the 3 candidates with the highest edge score
 * (winRate × expectancyR), then tracks their logged outcomes as R-multiples.
 * PENDING outcomes are excluded from running totals.
 *
 * Manual top-3 overrides (isTop3Pick === true) take precedence over auto-rank.
 * Each pick includes `earningsWarning: true` when the stock had an earnings
 * report within 0–5 calendar days of the session date (Rule 7 exclusion zone).
 * It is flagged only for a verified SIGNAL_TIME observation; legacy values
 * have unknown provenance and must not be treated as Rule 7 evidence.
 */
import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import { candidateSelectionScore, selectSourceBalancedCandidates } from "../lib/candidateRanking.ts";

const router: IRouter = Router();

router.get("/screener/analytics/top3", async (_req, res): Promise<void> => {
  const sessions = await db
    .select({ id: screenerSessionsTable.id, date: screenerSessionsTable.date, source: screenerSessionsTable.source, edgeWinRate: screenerSessionsTable.edgeWinRate })
    .from(screenerSessionsTable)
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

  // Per-direction (buy vs. sell picks) breakdown — same accounting as the
  // aggregate totals above, split by whether the pick was a LONG or SHORT.
  const byDirection = {
    LONG: { totalTrades: 0, wins: 0, losses: 0, totalR: 0 },
    SHORT: { totalTrades: 0, wins: 0, losses: 0, totalR: 0 },
  };

  const sessionResults = sessions.map((session) => {
    const candidates = bySession.get(session.id) ?? [];

    // Top 3 is deliberately per direction: up to three LONG and three SHORT
    // candidates. Manual choices override source-balanced auto-rank within
    // their own direction.
    const manualPicks = candidates.filter((c) => c.isTop3Pick === true);
    const selectDirection = (direction: "LONG" | "SHORT") => {
      const pool = candidates.filter((candidate) =>
        direction === "SHORT"
          ? candidate.direction === "SHORT"
          : candidate.direction !== "SHORT",
      );
      const manual = manualPicks.filter((candidate) =>
        direction === "SHORT"
          ? candidate.direction === "SHORT"
          : candidate.direction !== "SHORT",
      );
      return manual.length > 0
        ? [...manual].sort((a, b) => a.rank - b.rank || a.ticker.localeCompare(b.ticker)).slice(0, 3)
        : selectSourceBalancedCandidates(pool, 3);
    };
    const topLong = selectDirection("LONG");
    const topShort = selectDirection("SHORT");
    const top3 = [...topLong, ...topShort];

    let sessionR = 0;
    let sessionHasResolved = false;

    const picks = top3.map((c) => {
      const dirBucket = c.direction === "SHORT" ? byDirection.SHORT : byDirection.LONG;

      let r: number | null = null;
      // Resolutions written after realized-R support persist the authoritative
      // value. For old rows, only use a conservatively reconstructable exit;
      // never turn a planned R:R or a bare WIN/LOSS label into a performance
      // number.
      const legacyR = c.exitPrice != null
        ? (() => {
            const entry = c.resolutionEntryPrice ?? c.entryPrice;
            const stop = c.resolutionStopPrice ?? c.stopPrice;
            const direction = c.resolutionDirection ?? c.direction;
            const oneR = Math.abs(entry - stop);
            return oneR > 0
              ? (direction === "LONG" ? (c.exitPrice! - entry) / oneR : (entry - c.exitPrice!) / oneR)
              : null;
          })()
        : null;
      const persistedR = c.realizedR ?? legacyR;
      if (c.outcome === "WIN" && persistedR != null && persistedR > 0) {
        r = persistedR;
        wins++;
        totalTrades++;
        sessionHasResolved = true;
        sessionR += r;
        cumulativeR += r;
        dirBucket.wins++;
        dirBucket.totalTrades++;
        dirBucket.totalR += r;
      } else if (c.outcome === "LOSS" && persistedR != null && persistedR < 0) {
        r = persistedR;
        losses++;
        totalTrades++;
        sessionHasResolved = true;
        sessionR += r;
        cumulativeR += r;
        dirBucket.losses++;
        dirBucket.totalTrades++;
        dirBucket.totalR += r;
      }

      const eid = c.earningsInDays;
      const earningsWarning = c.earningsKnowledge === "SIGNAL_TIME" && eid != null && eid >= 0 && eid <= 5;

      return {
        ticker: c.ticker,
        direction: c.direction,
        edgeScore: Number(candidateSelectionScore(c).toFixed(4)),
        outcome: c.outcome,
        r,
        earningsWarning,
      };
    });

    // Direction split — informational picks per direction, not counted in cumulative R
    const mapInfoPick = (c: (typeof allCandidates)[0]) => {
      const eid = c.earningsInDays;
      const entry = c.resolutionEntryPrice ?? c.entryPrice;
      const stop = c.resolutionStopPrice ?? c.stopPrice;
      const direction = c.resolutionDirection ?? c.direction;
      const oneR = Math.abs(entry - stop);
      const legacyR = c.exitPrice != null && oneR > 0
        ? (direction === "LONG" ? (c.exitPrice - entry) / oneR : (entry - c.exitPrice) / oneR)
        : null;
      const persistedR = c.realizedR ?? legacyR;
      return {
        ticker: c.ticker,
        direction: c.direction,
        edgeScore: Number(candidateSelectionScore(c).toFixed(4)),
        outcome: c.outcome,
        r: (c.outcome === "WIN" && persistedR != null && persistedR > 0) ||
          (c.outcome === "LOSS" && persistedR != null && persistedR < 0)
          ? persistedR
          : null,
        earningsWarning: c.earningsKnowledge === "SIGNAL_TIME" && eid != null && eid >= 0 && eid <= 5,
      };
    };

    return {
      date: session.date,
      sessionId: session.id,
      source: session.source ?? null,
      picks,
      longPicks: topLong.map(mapInfoPick),
      shortPicks: topShort.map(mapInfoPick),
      edgeWinRate: session.edgeWinRate ?? null,
      sessionR: sessionHasResolved ? sessionR : null,
      cumulativeR,
    };
  });

  const winRate = totalTrades > 0 ? wins / totalTrades : null;
  const avgRPerTrade = totalTrades > 0 ? cumulativeR / totalTrades : null;

  const summarizeDirection = (b: { totalTrades: number; wins: number; losses: number; totalR: number }) => ({
    totalTrades: b.totalTrades,
    wins: b.wins,
    losses: b.losses,
    winRate: b.totalTrades > 0 ? b.wins / b.totalTrades : null,
    totalR: b.totalR,
    avgRPerTrade: b.totalTrades > 0 ? b.totalR / b.totalTrades : null,
  });

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
      byDirection: {
        LONG: summarizeDirection(byDirection.LONG),
        SHORT: summarizeDirection(byDirection.SHORT),
      },
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
    byDirection: {
      LONG: { totalTrades: 0, wins: 0, losses: 0, winRate: null, totalR: 0, avgRPerTrade: null },
      SHORT: { totalTrades: 0, wins: 0, losses: 0, winRate: null, totalR: 0, avgRPerTrade: null },
    },
  };
}

export default router;
