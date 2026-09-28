/**
 * Official Top 3 performance from immutable signal-time selection snapshots.
 * Legacy sessions without snapshots are returned as unavailable and are never
 * selected, ranked, or backfilled from their current candidate fields.
 */
import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import {
  db,
  screenerSessionsTable,
  candidatesTable,
  top3SelectionSnapshotsTable,
} from "@workspace/db";
import { resolveTradePerformance } from "../lib/tradePerformance.ts";

const router: IRouter = Router();

router.get("/screener/analytics/top3", async (_req, res): Promise<void> => {
  const sessions = await db
    .select({
      id: screenerSessionsTable.id,
      date: screenerSessionsTable.date,
      source: screenerSessionsTable.source,
      edgeWinRate: screenerSessionsTable.edgeWinRate,
      snapshotAt: screenerSessionsTable.top3SnapshotAt,
      policyVersion: screenerSessionsTable.top3PolicyVersion,
    })
    .from(screenerSessionsTable)
    .orderBy(asc(screenerSessionsTable.date));

  if (sessions.length === 0) {
    res.json({ sessions: [], stats: emptyStats() });
    return;
  }

  const [allCandidates, allSnapshots] = await Promise.all([
    db.select().from(candidatesTable),
    db.select().from(top3SelectionSnapshotsTable)
      .orderBy(
        asc(top3SelectionSnapshotsTable.sessionId),
        asc(top3SelectionSnapshotsTable.market),
        asc(top3SelectionSnapshotsTable.direction),
        asc(top3SelectionSnapshotsTable.rank),
      ),
  ]);
  const candidateById = new Map(allCandidates.map((candidate) => [candidate.id, candidate]));
  const snapshotsBySession = new Map<number, typeof allSnapshots>();
  for (const snapshot of allSnapshots) {
    const group = snapshotsBySession.get(snapshot.sessionId) ?? [];
    group.push(snapshot);
    snapshotsBySession.set(snapshot.sessionId, group);
  }

  let cumulativeR = 0;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  const byDirection = {
    LONG: { totalTrades: 0, wins: 0, losses: 0, totalR: 0 },
    SHORT: { totalTrades: 0, wins: 0, losses: 0, totalR: 0 },
  };

  const sessionResults = sessions.map((session) => {
    const snapshots = session.snapshotAt
      ? (snapshotsBySession.get(session.id) ?? []).filter((snapshot) => snapshot.selected)
      : [];
    const mapPick = (snapshot: (typeof allSnapshots)[number]) => {
      const candidate = candidateById.get(snapshot.candidateId);
      const performance = candidate ? resolveTradePerformance(candidate) : null;
      const direction = snapshot.direction === "SHORT" ? "SHORT" : "LONG";
      if (performance) {
        totalTrades++;
        cumulativeR += performance.r;
        const bucket = byDirection[direction];
        bucket.totalTrades++;
        bucket.totalR += performance.r;
        if (performance.result === "WIN") {
          wins++;
          bucket.wins++;
        } else if (performance.result === "LOSS") {
          losses++;
          bucket.losses++;
        }
      }
      return {
        candidateId: snapshot.candidateId,
        ticker: snapshot.ticker,
        category: snapshot.category,
        market: snapshot.market,
        direction: snapshot.direction,
        signalSource: snapshot.source ?? null,
        edgeScore: snapshot.score,
        rank: snapshot.rank,
        type: snapshot.type,
        policyVersion: snapshot.policyVersion,
        selectedAt: snapshot.selectedAt,
        review: snapshot.review,
        decision: snapshot.decision,
        earningsWarning: snapshot.earningsWarning,
        outcome: candidate?.outcome ?? "PENDING",
        r: performance?.r ?? null,
      };
    };

    let sessionR = 0;
    const picks = snapshots.map((snapshot) => {
      const pick = mapPick(snapshot);
      if (pick.r != null) sessionR += pick.r;
      return pick;
    });
    const sessionHasResolved = picks.some((pick) => pick.r != null);
    return {
      date: session.date,
      sessionId: session.id,
      source: session.source ?? null,
      selectionStatus: session.snapshotAt ? "AVAILABLE" : "UNAVAILABLE",
      selectionUnavailableReason: session.snapshotAt ? null : "No signal-time Top 3 snapshot was recorded for this legacy session.",
      selectedAt: session.snapshotAt,
      policyVersion: session.policyVersion,
      picks,
      longPicks: picks.filter((pick) => pick.direction === "LONG"),
      shortPicks: picks.filter((pick) => pick.direction === "SHORT"),
      edgeWinRate: session.edgeWinRate ?? null,
      sessionR: sessionHasResolved ? sessionR : null,
      cumulativeR,
    };
  });

  const winRate = totalTrades > 0 ? wins / totalTrades : null;
  const avgRPerTrade = totalTrades > 0 ? cumulativeR / totalTrades : null;
  const summarizeDirection = (bucket: { totalTrades: number; wins: number; losses: number; totalR: number }) => ({
    totalTrades: bucket.totalTrades,
    wins: bucket.wins,
    losses: bucket.losses,
    winRate: bucket.totalTrades > 0 ? bucket.wins / bucket.totalTrades : null,
    totalR: bucket.totalR,
    avgRPerTrade: bucket.totalTrades > 0 ? bucket.totalR / bucket.totalTrades : null,
  });

  res.json({
    sessions: sessionResults,
    stats: {
      totalSessions: sessions.length,
      availableSessions: sessions.filter((session) => session.snapshotAt != null).length,
      unavailableSessions: sessions.filter((session) => session.snapshotAt == null).length,
      completedSessions: sessionResults.filter((session) => session.sessionR !== null).length,
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
    availableSessions: 0,
    unavailableSessions: 0,
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