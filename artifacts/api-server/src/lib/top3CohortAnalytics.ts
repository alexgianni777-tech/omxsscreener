export interface Top3CohortPick {
  outcome: string;
  r: number | null;
  direction: string;
}

export interface Top3CohortSession {
  selectionStatus: "AVAILABLE" | "UNAVAILABLE";
  picks: Top3CohortPick[];
}

interface TradeSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  totalR: number;
  winRate: number | null;
  expectedValue: number | null;
}

function summarizeTrades(picks: Top3CohortPick[]): TradeSummary {
  const resolved = picks.filter((pick) => pick.r != null && Number.isFinite(pick.r));
  const wins = resolved.filter((pick) => pick.outcome === "WIN" || (pick.outcome === "TIME_EXIT" && pick.r! > 0)).length;
  const losses = resolved.filter((pick) => pick.outcome === "LOSS" || (pick.outcome === "TIME_EXIT" && pick.r! < 0)).length;
  const totalR = resolved.reduce((sum, pick) => sum + pick.r!, 0);
  return {
    totalTrades: resolved.length,
    wins,
    losses,
    totalR,
    winRate: resolved.length > 0 ? wins / resolved.length : null,
    expectedValue: resolved.length > 0 ? totalR / resolved.length : null,
  };
}

export function summarizeTop3Cohorts(sessions: Top3CohortSession[]) {
  const selectedPicks = sessions
    .filter((session) => session.selectionStatus === "AVAILABLE")
    .flatMap((session) => session.picks);
  const resolvedPicks = selectedPicks.filter((pick) => pick.r != null && Number.isFinite(pick.r));
  const pendingTrades = selectedPicks.filter((pick) => pick.outcome !== "SKIP" && (pick.r == null || !Number.isFinite(pick.r))).length;
  const excludedTrades = selectedPicks.filter((pick) => pick.outcome === "SKIP").length;
  const maturedSessions = sessions.filter((session) =>
    session.selectionStatus === "AVAILABLE" &&
    session.picks.length > 0 &&
    session.picks.every((pick) => pick.outcome === "SKIP" || (pick.r != null && Number.isFinite(pick.r))),
  );
  const resolvedOnly = summarizeTrades(resolvedPicks);
  const matureCohort = summarizeTrades(maturedSessions.flatMap((session) => session.picks));
  const summarizeDirection = (direction: "LONG" | "SHORT") => {
    const summary = summarizeTrades(maturedSessions.flatMap((session) =>
      session.picks.filter((pick) => pick.direction === direction),
    ));
    return {
      totalTrades: summary.totalTrades,
      wins: summary.wins,
      losses: summary.losses,
      winRate: summary.winRate,
      totalR: summary.totalR,
      avgRPerTrade: summary.expectedValue,
    };
  };

  return {
    selectedTrades: selectedPicks.length,
    resolvedTrades: resolvedPicks.length,
    pendingTrades,
    excludedTrades,
    resolutionRate: selectedPicks.length > 0 ? resolvedPicks.length / selectedPicks.length : null,
    maturedSessions: maturedSessions.length,
    resolvedOnly,
    matureCohort,
    byDirection: {
      LONG: summarizeDirection("LONG"),
      SHORT: summarizeDirection("SHORT"),
    },
  };
}