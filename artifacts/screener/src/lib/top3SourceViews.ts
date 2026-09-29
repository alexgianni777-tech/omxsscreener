import type { Top3Session } from "./useTop3Analytics";

/** Source-only views of immutable official picks; never reruns selection. */
export function top3SessionsForSource(
  sessions: Top3Session[],
  source: "edgeai" | "telegram",
): Top3Session[] {
  let cumulativeR = 0;
  return sessions.flatMap((session) => {
    const picks = session.picks.filter((pick) => pick.signalSource === source);
    if (picks.length === 0) return [];
    const resolved = picks.filter((pick) => pick.r != null && Number.isFinite(pick.r));
    const sessionR = resolved.length > 0
      ? resolved.reduce((sum, pick) => sum + pick.r!, 0)
      : null;
    if (sessionR != null) cumulativeR += sessionR;
    return [{
      ...session,
      source,
      picks,
      longPicks: picks.filter((pick) => pick.direction === "LONG"),
      shortPicks: picks.filter((pick) => pick.direction === "SHORT"),
      matured: picks.every((pick) =>
        pick.outcome === "SKIP" || (pick.r != null && Number.isFinite(pick.r)),
      ),
      edgeWinRate: source === "edgeai" ? session.edgeWinRate : null,
      sessionR,
      cumulativeR,
    }];
  });
}