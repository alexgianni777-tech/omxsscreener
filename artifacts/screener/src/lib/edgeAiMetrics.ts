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

/** Do not relabel neutral legacy columns as measured EdgeAI indicators. */
export function edgeAiIndicators(candidate: {
  signalRsi?: number | null;
  entryPrice?: number | null;
  stopPrice?: number | null;
  volMultiplier?: number | null;
  volumeAsOf?: string | null;
}) {
  const rsi = candidate.signalRsi;
  const entry = candidate.entryPrice;
  const stop = candidate.stopPrice;
  const volume = candidate.volMultiplier;
  return {
    rsi: rsi != null && Number.isFinite(rsi) && rsi >= 0 && rsi <= 100 ? rsi : null,
    oneR: entry != null && stop != null && Number.isFinite(entry) && Number.isFinite(stop) &&
      entry > 0 && stop > 0 && entry !== stop ? Math.abs(entry - stop) : null,
    volume: volume != null && Number.isFinite(volume) && volume > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(candidate.volumeAsOf ?? "") ? volume : null,
  };
}