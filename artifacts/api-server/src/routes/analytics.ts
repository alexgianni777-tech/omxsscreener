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
 * The `earningsInDays` value is stored at import time, so it reflects the
 * earnings calendar that existed when the session was imported.
 */
import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";

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

  const sessionResults = sessions.map((session) => {
    const candidates = bySession.get(session.id) ?? [];

    // Sort by edge score descending: (winRate/100) × (expectancyR×100/100)
    // = perf1m × rsi — monotone so no need to divide
    const sorted = [...candidates].sort(
      (a, b) => (b.perf1m ?? 0) * (b.rsi ?? 0) - (a.perf1m ?? 0) * (a.rsi ?? 0),
    );

    // Prefer manually starred picks; fall back to auto-rank by edge score
    const manualPicks = candidates.filter((c) => c.isTop3Pick === true);
    const top3 = manualPicks.length > 0 ? manualPicks.slice(0, 3) : sorted.slice(0, 3);

    let sessionR = 0;
    let sessionHasResolved = false;

    const picks = top3.map((c) => {
      // Use the dedicated rr column (volMultiplier now stores volume ratio, not R:R)
      const rr = (c.rr ?? 0) > 0 ? (c.rr as number) : 1.5;

      let r: number | null = null;
      if (c.outcome === "WIN") {
        r = rr;
        wins++;
        totalTrades++;
        sessionHasResolved = true;
        sessionR += r;
        cumulativeR += r;
      } else if (c.outcome === "LOSS") {
        r = -1;
        losses++;
        totalTrades++;
        sessionHasResolved = true;
        sessionR += r;
        cumulativeR += r;
      }

      // earningsWarning: true when earningsInDays (stored at import time) is
      // within the 0–5 day Rule 7 exclusion window.
      const eid = c.earningsInDays;
      const earningsWarning = eid != null && eid >= 0 && eid <= 5;

      return {
        ticker: c.ticker,
        direction: c.direction,
        edgeScore: Number(
          (((c.perf1m ?? 0) / 100) * ((c.rsi ?? 0) / 100)).toFixed(4),
        ),
        outcome: c.outcome,
        r,
        earningsWarning,
      };
    });

    // Direction split — informational picks per direction, not counted in cumulative R
    const sortedLong = sorted.filter((c) => c.direction !== "SHORT");
    const sortedShort = sorted.filter((c) => c.direction === "SHORT");
    const manualLong = manualPicks.filter((c) => c.direction !== "SHORT");
    const manualShort = manualPicks.filter((c) => c.direction === "SHORT");
    const topLong = (manualLong.length > 0 ? manualLong : sortedLong).slice(0, 3);
    const topShort = (manualShort.length > 0 ? manualShort : sortedShort).slice(0, 3);

    const mapInfoPick = (c: (typeof allCandidates)[0]) => {
      const rr = (c.rr ?? 0) > 0 ? (c.rr as number) : 1.5;
      const eid = c.earningsInDays;
      return {
        ticker: c.ticker,
        direction: c.direction,
        edgeScore: Number((((c.perf1m ?? 0) / 100) * ((c.rsi ?? 0) / 100)).toFixed(4)),
        outcome: c.outcome,
        r: c.outcome === "WIN" ? rr : c.outcome === "LOSS" ? -1 : null,
        earningsWarning: eid != null && eid >= 0 && eid <= 5,
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
