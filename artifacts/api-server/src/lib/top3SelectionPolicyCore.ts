import { candidateSelectionScore, selectSourceBalancedCandidates } from "./candidateRanking.ts";
import { decideCandidate, reviewCandidate } from "./screeningReview.ts";

export const TOP3_POLICY_VERSION = "official-top3-v1";
export const TOP3_SELECTION_TYPE = "AUTO";

export type PolicyCandidate = {
  id: number;
  ticker: string;
  category: string;
  rank: number;
  market: "SE" | "US" | null;
  direction: "LONG" | "SHORT";
  signalSource: "edgeai" | "telegram" | "manual" | "screener" | null;
  signalDate: string | null;
  price: number;
  perf1m: number;
  rs3m: number;
  rsi: number;
  pctB: number;
  distFrom20dH: number;
  edgeExpectancyR: number | null;
  edgeSampleN: number | null;
  signalAgeBars: number | null;
  maxHoldDays: number | null;
  signalRsi: number | null;
  signalGapPct: number | null;
  volMultiplier: number;
  volumeAsOf: string | null;
  earningsInDays: number | null;
  earningsKnowledge: "SIGNAL_TIME" | "UNKNOWN" | null;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
};

export type SnapshotInput = {
  sessionId: number;
  candidateId: number;
  ticker: string;
  category: string;
  selected: boolean;
  rank: number | null;
  score: number;
  review: { status: string; reasons: string[] };
  decision: { status: string; reasons: string[] };
  earningsWarning: boolean;
  policyVersion: string;
  selectedAt: Date;
  type: string;
  market: "SE" | "US" | null;
  direction: "LONG" | "SHORT";
  source: "edgeai" | "telegram" | "manual" | "screener" | null;
};

function tickerConflictKey(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\.ST$/, "");
}

/** Build a frozen signal-time selection; user stars are annotations only. */
export function buildTop3SelectionSnapshot(
  candidates: PolicyCandidate[],
  sessionId: number,
  sessionDate: string,
  sessionSource: string | null,
  selectedAt = new Date(),
): SnapshotInput[] {
  const evaluated = candidates.map((candidate) => {
    const review = reviewCandidate(candidate, sessionSource);
    const decision = decideCandidate(candidate, review, sessionDate, selectedAt);
    const rawScore = candidateSelectionScore(candidate);
    return {
      candidate,
      review,
      decision,
      score: Number.isFinite(rawScore) ? Number(rawScore.toFixed(6)) : 0,
    };
  });

  const eligible = evaluated.filter(({ decision, candidate }) =>
    decision.status === "TRADEABLE" &&
    candidate.signalDate === sessionDate &&
    Boolean(candidate.signalSource) &&
    (candidate.market === "SE" || candidate.market === "US"),
  );
  const selectedIds = new Set<number>();
  const selectedTickerDirection = new Map<string, "LONG" | "SHORT">();

  // Group order is policy-versioned and resolves opposing signals consistently.
  for (const market of ["SE", "US"] as const) {
    for (const direction of ["LONG", "SHORT"] as const) {
      const pool = eligible
        .filter(({ candidate }) => candidate.market === market && candidate.direction === direction)
        .map(({ candidate }) => candidate);
      const ranked = selectSourceBalancedCandidates(pool, pool.length);
      const seenGroupTickers = new Set<string>();
      let groupSelected = 0;
      for (const candidate of ranked) {
        const key = tickerConflictKey(candidate.ticker);
        const priorDirection = selectedTickerDirection.get(key);
        if (seenGroupTickers.has(key) || (priorDirection && priorDirection !== direction)) continue;
        seenGroupTickers.add(key);
        selectedIds.add(candidate.id);
        if (!priorDirection) selectedTickerDirection.set(key, direction);
        groupSelected++;
        if (groupSelected === 3) break;
      }
    }
  }

  const eligibleRanks = new Map<number, number>();
  for (const market of ["SE", "US"] as const) {
    for (const direction of ["LONG", "SHORT"] as const) {
      const pool = eligible
        .filter(({ candidate }) => candidate.market === market && candidate.direction === direction)
        .map(({ candidate }) => candidate);
      selectSourceBalancedCandidates(pool, pool.length)
        .forEach((candidate, index) => eligibleRanks.set(candidate.id, index + 1));
    }
  }

  return evaluated.map(({ candidate, review, decision, score }) => ({
    sessionId,
    candidateId: candidate.id,
    ticker: candidate.ticker,
    category: candidate.category,
    selected: selectedIds.has(candidate.id),
    rank: eligibleRanks.get(candidate.id) ?? null,
    score,
    review,
    decision,
    earningsWarning: candidate.earningsKnowledge === "SIGNAL_TIME" &&
      candidate.earningsInDays != null && candidate.earningsInDays >= 0 && candidate.earningsInDays <= 5,
    policyVersion: TOP3_POLICY_VERSION,
    selectedAt,
    type: TOP3_SELECTION_TYPE,
    market: candidate.market,
    direction: candidate.direction,
    source: candidate.signalSource,
  }));
}