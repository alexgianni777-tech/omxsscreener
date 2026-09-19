type RankableCandidate = {
  signalSource?: string | null;
  direction: string;
  category: string;
  rank: number;
  ticker: string;
  perf1m: number;
  rs3m: number;
  rsi: number;
  pctB: number;
  distFrom20dH: number;
};

const SOURCE_ORDER = ["edgeai", "telegram", "manual", "screener", "unknown"];
const MAX_HOLD_DAYS: Record<string, number> = {
  MOMENTUM: 10,
  SQUEEZE: 15,
  STUDS: 5,
  WEAKEST: 10,
};

export function candidateSelectionScore(candidate: RankableCandidate): number {
  if (candidate.signalSource === "edgeai") {
    const expectancyR = candidate.rsi / 100;
    const sampleN = Math.max(0, candidate.pctB);
    const reliability = sampleN / (sampleN + 20);
    const maxHoldDays = MAX_HOLD_DAYS[candidate.category] ?? 10;
    const ageDecay = Math.max(0, 1 - Math.max(0, candidate.distFrom20dH) / maxHoldDays);
    return expectancyR * reliability * ageDecay;
  }

  const directionSign = candidate.direction === "SHORT" ? -1 : 1;
  return directionSign * (candidate.perf1m + candidate.rs3m) / 100;
}

function compareWithinSource<T extends RankableCandidate>(a: T, b: T): number {
  return candidateSelectionScore(b) - candidateSelectionScore(a) ||
    a.rank - b.rank ||
    a.ticker.localeCompare(b.ticker);
}

/**
 * Never compare EdgeAI expectancy fields directly with Telegram/manual RSI and
 * momentum fields. Rank within each provenance first, then interleave sources.
 */
export function selectSourceBalancedCandidates<T extends RankableCandidate>(
  candidates: T[],
  limit: number,
): T[] {
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const source = candidate.signalSource ?? "unknown";
    const group = groups.get(source) ?? [];
    group.push(candidate);
    groups.set(source, group);
  }
  for (const group of groups.values()) group.sort(compareWithinSource);

  const orderedSources = [...groups.keys()].sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(a);
    const bi = SOURCE_ORDER.indexOf(b);
    return (ai === -1 ? SOURCE_ORDER.length : ai) - (bi === -1 ? SOURCE_ORDER.length : bi) ||
      a.localeCompare(b);
  });

  const selected: T[] = [];
  let index = 0;
  while (selected.length < limit) {
    let added = false;
    for (const source of orderedSources) {
      const candidate = groups.get(source)?.[index];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    index++;
  }
  return selected;
}