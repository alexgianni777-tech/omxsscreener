export type ReviewStatus = "APPROVED" | "WARN" | "BLOCKED";

export type CandidateReviewInput = {
  category: string;
  direction: string;
  rs3m: number;
  perf1m: number;
  rsi: number;
  signalRsi: number | null;
  signalGapPct: number | null;
  volMultiplier: number;
  earningsInDays: number | null;
  earningsKnowledge: "SIGNAL_TIME" | "UNKNOWN" | null;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  signalSource?: string | null;
};

export type SignalReview = {
  status: ReviewStatus;
  reasons: string[];
};

export type CandidateDecisionStatus = "TRADEABLE" | "WAIT" | "BLOCKED" | "INVALID" | "STALE";

export type CandidateDecision = {
  status: CandidateDecisionStatus;
  reasons: string[];
};

const STOCKHOLM_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function statusFor(reasons: string[], blockers: string[]): ReviewStatus {
  if (blockers.length > 0) return "BLOCKED";
  return reasons.length > 0 ? "WARN" : "APPROVED";
}

export function reviewCandidate(
  candidate: CandidateReviewInput,
  source: string | null,
): SignalReview {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const isShort = candidate.direction === "SHORT";
  const isEdgeAi = (candidate.signalSource ?? source) === "edgeai";

  if (!Number.isFinite(candidate.volMultiplier) || candidate.volMultiplier <= 0) {
    blockers.push("Volymdata saknas — ingen kvalificerad trade.");
  } else if (candidate.volMultiplier < 0.2) {
    warnings.push(`Låg relativ volym (${candidate.volMultiplier.toFixed(1)}x).`);
  }

  if (
    !Number.isFinite(candidate.entryPrice) ||
    !Number.isFinite(candidate.stopPrice) ||
    !Number.isFinite(candidate.targetPrice) ||
    candidate.entryPrice <= 0 ||
    candidate.stopPrice <= 0 ||
    candidate.targetPrice <= 0
  ) {
    blockers.push("Ofullständig entry-, stop- eller targetdata.");
  } else if (
    (!isShort && (candidate.stopPrice >= candidate.entryPrice || candidate.targetPrice <= candidate.entryPrice)) ||
    (isShort && (candidate.stopPrice <= candidate.entryPrice || candidate.targetPrice >= candidate.entryPrice))
  ) {
    blockers.push("Tradeplanens riktning stämmer inte med entry, stop och target.");
  }

  if (candidate.rr < 1.2) blockers.push(`R:R ${candidate.rr.toFixed(2)} är under miniminivån 1,2.`);
  if (isEdgeAi && candidate.rsi < 0) {
    blockers.push(`Negativ historisk förväntan (${(candidate.rsi / 100).toFixed(2)}R).`);
  }
  if (candidate.earningsKnowledge !== "SIGNAL_TIME") {
    warnings.push("Regel 7 ej bedömbar: rapportkalender saknar verifierad signal-tidsobservation.");
  } else if (candidate.earningsInDays != null && candidate.earningsInDays >= 0 && candidate.earningsInDays <= 5) {
    blockers.push(`Rapport inom ${candidate.earningsInDays} dagar — exkluderas enligt Regel 7.`);
  }

  const targetDistance = candidate.entryPrice > 0 && candidate.targetPrice > 0
    ? Math.abs((candidate.targetPrice - candidate.entryPrice) / candidate.entryPrice) * 100
    : 0;
  if (targetDistance > 10) warnings.push(`Target ligger ${targetDistance.toFixed(1)}% från entry.`);

  if (!isEdgeAi && candidate.category === "MOMENTUM" && !isShort) {
    if (candidate.perf1m <= 0) blockers.push("Momentum saknar positiv 1-månadsutveckling.");
    if (candidate.rs3m <= 0) blockers.push("Momentum saknar positiv relativ styrka.");
  }

  if (isShort) {
    const shortRsi = isEdgeAi ? candidate.signalRsi : candidate.rsi;
    if (shortRsi != null && shortRsi > 0 && shortRsi < 35) {
      blockers.push(`Short är översåld (RSI ${shortRsi.toFixed(1)}) och stoppas.`);
    }
    if (candidate.signalGapPct != null && candidate.signalGapPct >= 2.5) {
      blockers.push(`Short har uppgap på ${candidate.signalGapPct.toFixed(1)}% och stoppas.`);
    }
    if (!isEdgeAi && candidate.rs3m > 0) {
      blockers.push("Short saknar negativ relativ styrka.");
    }
  }

  const reasons = [...blockers, ...warnings];
  return { status: statusFor(warnings, blockers), reasons };
}

/**
 * A trader-facing decision derived from the already persisted signal and its
 * review.  This deliberately does not infer whether a Yahoo request succeeded:
 * that provenance is not stored with legacy candidates.  It only reports
 * missing/invalid values that are actually present in the candidate record.
 */
export function decideCandidate(
  candidate: CandidateReviewInput & { price: number },
  review: SignalReview,
  sessionDate: string,
  now = new Date(),
): CandidateDecision {
  const invalid: string[] = [];
  if (!Number.isFinite(candidate.price) || candidate.price <= 0) {
    invalid.push("Screenad kurs saknas eller är ogiltig.");
  }
  if (!Number.isFinite(candidate.volMultiplier) || candidate.volMultiplier <= 0) {
    invalid.push("Volymdata saknas eller är ogiltig.");
  }
  const isEdgeAi = (candidate.signalSource ?? null) === "edgeai";
  if (!Number.isFinite(candidate.rsi) || (!isEdgeAi && candidate.rsi < 0)) {
    invalid.push("RSI-data saknas eller är ogiltig.");
  }
  if (!Number.isFinite(candidate.rr) || candidate.rr <= 0) {
    invalid.push("R:R saknas eller är ogiltig.");
  }
  if (
    !Number.isFinite(candidate.entryPrice) || candidate.entryPrice <= 0 ||
    !Number.isFinite(candidate.stopPrice) || candidate.stopPrice <= 0 ||
    !Number.isFinite(candidate.targetPrice) || candidate.targetPrice <= 0
  ) {
    invalid.push("Entry-, stop- eller targetdata saknas eller är ogiltig.");
  }
  if (invalid.length > 0) return { status: "INVALID", reasons: [...invalid, ...review.reasons] };

  const today = STOCKHOLM_DATE.format(now);
  if (sessionDate < today) {
    return {
      status: "STALE",
      reasons: [`Signalen är från ${sessionDate}; kontrollera en ny snapshot och live-pris före trade.`, ...review.reasons],
    };
  }
  if (review.status === "BLOCKED") return { status: "BLOCKED", reasons: review.reasons };
  if (review.status === "WARN") return { status: "WAIT", reasons: review.reasons };
  return {
    status: "TRADEABLE",
    reasons: ["Screeningsreglerna är godkända för dagens signal."],
  };
}

export function reviewSession(
  candidateReviews: SignalReview[],
  marketRsi: number,
): SignalReview & { tradableCount: number } {
  const tradableCount = candidateReviews.filter((review) => review.status === "APPROVED").length;
  const reasons: string[] = [];
  if (!Number.isFinite(marketRsi) || marketRsi <= 0) {
    reasons.push("Marknads-RSI saknas — marknadsregimen är inte fullt verifierad.");
  }
  if (tradableCount === 0) reasons.unshift("Ingen kvalificerad trade idag.");

  return {
    status: tradableCount === 0 ? "BLOCKED" : reasons.length > 0 ? "WARN" : "APPROVED",
    reasons,
    tradableCount,
  };
}