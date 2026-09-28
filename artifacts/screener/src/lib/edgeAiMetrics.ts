export type EdgeAICandidateMetrics = {
  signalSource?: string | null;
  edgeWinRate?: number | null;
  edgeExpectancyR?: number | null;
  edgeSampleN?: number | null;
  signalAgeBars?: number | null;
  maxHoldDays?: number | null;
  // Legacy screener columns are accepted for callers but never used as fallbacks.
  rsi?: number | null;
  perf1m?: number | null;
  pctB?: number | null;
  distFrom20dH?: number | null;
};

/** EdgeAI statistics come only from their dedicated candidate fields. */
export function edgeAiMetrics(candidate: EdgeAICandidateMetrics) {
  const isEdgeAI = candidate.signalSource === "edgeai";
  if (!isEdgeAI) {
    return {
      isEdgeAI,
      winRate: null,
      expectancyR: null,
      sampleN: null,
      signalAgeBars: null,
      maxHoldDays: null,
    };
  }

  return {
    isEdgeAI,
    winRate: candidate.edgeWinRate ?? null,
    expectancyR: candidate.edgeExpectancyR ?? null,
    sampleN: candidate.edgeSampleN ?? null,
    signalAgeBars: candidate.signalAgeBars ?? null,
    maxHoldDays: candidate.maxHoldDays ?? null,
  };
}

export function edgeAiScore(candidate: EdgeAICandidateMetrics): number | null {
  const metrics = edgeAiMetrics(candidate);
  if (
    !metrics.isEdgeAI ||
    metrics.expectancyR == null ||
    metrics.sampleN == null ||
    metrics.signalAgeBars == null ||
    metrics.maxHoldDays == null ||
    metrics.maxHoldDays <= 0
  ) return null;

  const reliability = metrics.sampleN / (Math.max(0, metrics.sampleN) + 20);
  const ageDecay = Math.max(0, 1 - Math.max(0, metrics.signalAgeBars) / metrics.maxHoldDays);
  return metrics.expectancyR * reliability * ageDecay;
}