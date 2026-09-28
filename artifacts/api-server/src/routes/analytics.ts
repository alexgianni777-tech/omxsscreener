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
import { summarizeTop3Cohorts } from "../lib/top3CohortAnalytics.ts";
import { describeTop3Snapshot } from "../lib/top3SnapshotStatus.ts";

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
      top3SnapshotAt: screenerSessionsTable.top3SnapshotAt,
      top3PolicyVersion: screenerSessionsTable.top3PolicyVersion,
      top3CutoffAt: screenerSessionsTable.top3CutoffAt,
      top3CutoffEvaluatedAt: screenerSessionsTable.top3CutoffEvaluatedAt,
      top3ParticipatingSources: screenerSessionsTable.top3ParticipatingSources,
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

  const sessionResults = sessions.map((session) => {
    const snapshotStatus = describeTop3Snapshot(session);
    const snapshots = session.snapshotAt
      ? (snapshotsBySession.get(session.id) ?? []).filter((snapshot) => snapshot.selected)
      : [];
    const mapPick = (snapshot: (typeof allSnapshots)[number]) => {
      const candidate = candidateById.get(snapshot.candidateId);
      const performance = candidate ? resolveTradePerformance(candidate) : null;
      if (performance) {
        cumulativeR += performance.r;
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
      selectionStatus: snapshotStatus.available ? "AVAILABLE" as const : "UNAVAILABLE" as const,
      selectionUnavailableReason: snapshotStatus.unavailableReason,
      cutoffState: snapshotStatus.state,
      cutoffAt: snapshotStatus.cutoffAt,
      cutoffEvaluatedAt: snapshotStatus.evaluatedAt,
      participatingSources: snapshotStatus.participatingSources,
      requiredSources: snapshotStatus.requiredSources,
      selectedAt: session.snapshotAt,
      policyVersion: session.policyVersion,
      picks,
      longPicks: picks.filter((pick) => pick.direction === "LONG"),
      shortPicks: picks.filter((pick) => pick.direction === "SHORT"),
      matured: picks.length > 0 && picks.every((pick) =>
        pick.outcome === "SKIP" || (pick.r != null && Number.isFinite(pick.r)),
      ),
      edgeWinRate: session.edgeWinRate ?? null,
      sessionR: sessionHasResolved ? sessionR : null,
      cumulativeR,
    };
  });

  const cohorts = summarizeTop3Cohorts(sessionResults.map((session) => ({
    selectionStatus: session.selectionStatus as "AVAILABLE" | "UNAVAILABLE",
    picks: session.picks,
  })));
  const { totalTrades, wins, losses, winRate, totalR, expectedValue } = cohorts.matureCohort;
  const resolvedOnly = cohorts.resolvedOnly;

  res.json({
    sessions: sessionResults,
    stats: {
      totalSessions: sessions.length,
      availableSessions: sessions.filter((session) => session.snapshotAt != null).length,
      unavailableSessions: sessions.filter((session) => session.snapshotAt == null).length,
      completedSessions: sessionResults.filter((session) => session.sessionR !== null).length,
      selectedTrades: cohorts.selectedTrades,
      resolvedTrades: cohorts.resolvedTrades,
      pendingTrades: cohorts.pendingTrades,
      excludedTrades: cohorts.excludedTrades,
      resolutionRate: cohorts.resolutionRate,
      maturedSessions: cohorts.maturedSessions,
      totalTrades,
      wins,
      losses,
      winRate,
      totalR,
      avgRPerTrade: expectedValue,
      expectedValue,
      resolvedOnlyTrades: resolvedOnly.totalTrades,
      resolvedOnlyWins: resolvedOnly.wins,
      resolvedOnlyLosses: resolvedOnly.losses,
      resolvedOnlyWinRate: resolvedOnly.winRate,
      resolvedOnlyExpectedValue: resolvedOnly.expectedValue,
      resolvedOnlyTotalR: resolvedOnly.totalR,
      resolvedOnlyAvgRPerTrade: resolvedOnly.expectedValue,
      byDirection: {
        LONG: cohorts.byDirection.LONG,
        SHORT: cohorts.byDirection.SHORT,
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
    selectedTrades: 0,
    resolvedTrades: 0,
    pendingTrades: 0,
    excludedTrades: 0,
    resolutionRate: null,
    maturedSessions: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    totalR: 0,
    avgRPerTrade: null,
    expectedValue: null,
    resolvedOnlyTrades: 0,
    resolvedOnlyWins: 0,
    resolvedOnlyLosses: 0,
    resolvedOnlyWinRate: null,
    resolvedOnlyExpectedValue: null,
    resolvedOnlyTotalR: 0,
    resolvedOnlyAvgRPerTrade: null,
    byDirection: {
      LONG: { totalTrades: 0, wins: 0, losses: 0, winRate: null, totalR: 0, avgRPerTrade: null },
      SHORT: { totalTrades: 0, wins: 0, losses: 0, winRate: null, totalR: 0, avgRPerTrade: null },
    },
  };
}

export default router;