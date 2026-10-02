import { candidateSelectionScore, selectSourceBalancedCandidates } from "./candidateRanking.ts";
import { decideCandidate, reviewCandidate } from "./screeningReview.ts";

export const TOP3_POLICY_VERSION = "official-top3-v4";
export const TOP3_SELECTION_TYPE = "AUTO";
export const TOP3_CUTOFF_HOUR = 16;
export const TOP3_CUTOFF_MINUTE = 30;
export const TOP3_REQUIRED_SOURCES = ["telegram", "edgeai"] as const;

const STOCKHOLM_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Resolve the legacy timed cutoff, including DST; new freezes use source readiness. */
export function top3CutoffForDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const desiredLocalAsUtc = Date.UTC(year, month - 1, day, TOP3_CUTOFF_HOUR, TOP3_CUTOFF_MINUTE);
  let instant = desiredLocalAsUtc;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = Object.fromEntries(
      STOCKHOLM_DATE_TIME.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    const representedLocalAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    instant += desiredLocalAsUtc - representedLocalAsUtc;
  }
  return new Date(instant);
}

export function isTop3CutoffDue(date: string, now: Date): boolean {
  return now.getTime() >= top3CutoffForDate(date).getTime();
}

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
  const directionsByTicker = new Map<string, Set<"LONG" | "SHORT">>();
  for (const { candidate } of eligible) {
    const key = tickerConflictKey(candidate.ticker);
    const directions = directionsByTicker.get(key) ?? new Set<"LONG" | "SHORT">();
    directions.add(candidate.direction);
    directionsByTicker.set(key, directions);
  }
  const conflictingTickers = new Set(
    [...directionsByTicker]
      .filter(([, directions]) => directions.size > 1)
      .map(([ticker]) => ticker),
  );
  const conflictingCandidateIds = new Set(
    eligible
      .filter(({ candidate }) => conflictingTickers.has(tickerConflictKey(candidate.ticker)))
      .map(({ candidate }) => candidate.id),
  );
  const effectiveEvaluated = evaluated.map((entry) => {
    if (!conflictingCandidateIds.has(entry.candidate.id)) return entry;
    return {
      ...entry,
      decision: {
        status: "CONFLICT",
        reasons: [...entry.decision.reasons, "CONFLICT: opposing LONG and SHORT signals for the same underlying"],
      },
    };
  });
  const conflictFreeEligible = eligible.filter(
    ({ candidate }) => !conflictingTickers.has(tickerConflictKey(candidate.ticker)),
  );
  const selectedIds = new Set<number>();

  // Ranking and source balance are unchanged; opposing underlying signals are
  // excluded before ranking rather than arbitrarily preferring one direction.
  for (const market of ["SE", "US"] as const) {
    for (const direction of ["LONG", "SHORT"] as const) {
      const pool = conflictFreeEligible
        .filter(({ candidate }) => candidate.market === market && candidate.direction === direction)
        .map(({ candidate }) => candidate);
      const ranked = selectSourceBalancedCandidates(pool, pool.length);
      const seenGroupTickers = new Set<string>();
      let groupSelected = 0;
      for (const candidate of ranked) {
        const key = tickerConflictKey(candidate.ticker);
        if (seenGroupTickers.has(key)) continue;
        seenGroupTickers.add(key);
        selectedIds.add(candidate.id);
        groupSelected++;
        if (groupSelected === 3) break;
      }
    }
  }

  const eligibleRanks = new Map<number, number>();
  for (const market of ["SE", "US"] as const) {
    for (const direction of ["LONG", "SHORT"] as const) {
      const pool = conflictFreeEligible
        .filter(({ candidate }) => candidate.market === market && candidate.direction === direction)
        .map(({ candidate }) => candidate);
      selectSourceBalancedCandidates(pool, pool.length)
        .forEach((candidate, index) => eligibleRanks.set(candidate.id, index + 1));
    }
  }

  return effectiveEvaluated.map(({ candidate, review, decision, score }) => ({
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