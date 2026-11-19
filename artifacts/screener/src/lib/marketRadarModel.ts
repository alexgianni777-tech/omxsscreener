import type { Candidate, SessionSourceReport } from "@workspace/api-client-react";

export type RadarCandidate = Pick<Candidate, "id" | "ticker" | "market" | "direction" | "signalSource" | "rank">;

export type RadarSourceHealth = {
  source: "edgeai" | "telegram" | "screener" | "manual";
  latest: SessionSourceReport | null;
  candidateCount: number;
  status: "IMPORTED" | "FAILED" | "NO_RECEIPT";
};

/**
 * Select a compact lane while taking turns across sources. All candidates stay
 * in their original source/status; this is a display cap, not a new ranking.
 */
export function selectRadarLane(
  candidates: readonly RadarCandidate[],
  market: "SE" | "US" | null,
  direction: "LONG" | "SHORT",
  limit = 5,
): RadarCandidate[] {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const matching = candidates.filter((candidate) =>
    candidate.market === market && candidate.direction === direction,
  );
  const bySource = new Map<string, RadarCandidate[]>();
  for (const candidate of matching) {
    const source = candidate.signalSource ?? "unknown";
    bySource.set(source, [...(bySource.get(source) ?? []), candidate]);
  }
  const groups = [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, rows]) => rows.slice().sort((a, b) =>
      a.rank - b.rank || a.ticker.localeCompare(b.ticker) || a.id - b.id,
    ));

  const selected: RadarCandidate[] = [];
  const offsets = groups.map(() => 0);
  while (selected.length < limit) {
    let added = false;
    for (let i = 0; i < groups.length && selected.length < limit; i += 1) {
      const candidate = groups[i][offsets[i]];
      if (!candidate) continue;
      selected.push(candidate);
      offsets[i] += 1;
      added = true;
    }
    if (!added) break;
  }
  return selected;
}

/** Only pair a candidate with a receipt from its source and signal day. */
export function candidateReceipt(candidate: Candidate, reports: readonly SessionSourceReport[]) {
  if (!candidate.signalSource || !candidate.signalDate) return null;
  const sameSignal = reports.filter(report =>
    report.status === "SUCCESS" &&
    report.source === candidate.signalSource &&
    report.signalDate === candidate.signalDate,
  );
  if (candidate.dataQuality?.dataAsOf && (candidate.market === "SE" || candidate.market === "US")) {
    const sameDataDay = sameSignal.filter(report =>
      report.dataDates?.[candidate.market as "SE" | "US"] === candidate.dataQuality?.dataAsOf,
    );
    return sameDataDay.length === 1 ? sameDataDay[0] : null;
  }
  return sameSignal.length === 1 ? sameSignal[0] : null;
}

export function radarSourceHealth(
  candidates: readonly Candidate[],
  reports: readonly SessionSourceReport[],
): RadarSourceHealth[] {
  return (["edgeai", "telegram", "screener", "manual"] as const).map(source => {
    const history = reports.filter(report => report.source === source);
    const latest = history.slice().sort((a, b) => a.importedAt.localeCompare(b.importedAt)).at(-1) ?? null;
    return {
      source,
      latest,
      candidateCount: candidates.filter(candidate => candidate.signalSource === source).length,
      status: latest?.status === "FAILED" ? "FAILED" as const :
        latest?.status === "SUCCESS" ? "IMPORTED" as const : "NO_RECEIPT" as const,
    };
  });
}
