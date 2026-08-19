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
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
};

export type SignalReview = {
  status: ReviewStatus;
  reasons: string[];
};

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
  const isEdgeAi = source === "edgeai";

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
  if (candidate.earningsInDays != null && candidate.earningsInDays >= 0 && candidate.earningsInDays <= 5) {
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

export function reviewSession(
  candidateReviews: SignalReview[],
  marketRsi: number,
): SignalReview & { tradableCount: number } {
  const tradableCount = candidateReviews.filter((review) => review.status !== "BLOCKED").length;
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