import { isAcceptedSignalDate } from "./signalDatePolicy";
import { marketDate, signalSessionDate, observedReportDate, reportWindow, validMarketDate } from "@workspace/market-calendar";
import { resolveYahooTicker } from "./omxs30TickerMap";
import { qualifyResearch,marketRegime,evidenceDataDate,hasVerifiedAtr,BOARD_REVIEW_REQUIRED,
  type SourceReport,type Qualification } from "@workspace/market-calendar/research-policy";

export type ReviewStatus = "APPROVED" | "WARN" | "BLOCKED";

/** Legacy provider-fetch switch. Strict stored-evidence validation below is
 * independent: do not enable new Yahoo requests while enforcing report safety.
 */
export const AUTOMATIC_EARNINGS_CHECK_ENABLED = false;

export type CandidateReviewInput = {
  ticker?: string;
  market?: string | null;
  category: string;
  direction: string;
  rs3m: number;
  perf1m: number;
  rsi: number;
  pctB?: number | null;
  atr?: number | null;
  edgeExpectancyR?: number | null;
  edgeSampleN?: number | null;
  signalAgeBars?: number | null;
  maxHoldDays?: number | null;
  signalRsi: number | null;
  signalGapPct: number | null;
  volMultiplier: number;
  volumeAsOf?: string | null;
  earningsInDays: number | null;
  earningsKnowledge: "SIGNAL_TIME" | "UNKNOWN" | null;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  signalSource?: string | null;
  signalDate?: string | null;
  dataQuality?: unknown;
  dataDate?: string | null;
};
export type PolicyContext={reports?:readonly SourceReport[];dataDate?:string|null};
export function candidateQualification(candidate:CandidateReviewInput,source:string|null,now=new Date(),context:PolicyContext={}):Qualification {
  const e={...candidate,signalSource:candidate.signalSource??source,
    ...(context.dataDate!==undefined?{dataDate:context.dataDate}:{})};
  return qualifyResearch(e,marketRegime(context.reports??[],e.market??"",evidenceDataDate(e),now),now);
}

export type SignalReview = {
  status: ReviewStatus;
  reasons: string[];
};

export type CandidateDecisionStatus = "TRADEABLE" | "WAIT" | "BLOCKED" | "INVALID" | "STALE";

export type CandidateDecision = {
  status: CandidateDecisionStatus;
  reasons: string[];
};

function statusFor(reasons: string[], blockers: string[]): ReviewStatus {
  if (blockers.length > 0) return "BLOCKED";
  return reasons.length > 0 ? "WARN" : "APPROVED";
}

export function reviewCandidate(
  candidate: CandidateReviewInput,
  source: string | null,
  now = new Date(),
  context:PolicyContext={},
): SignalReview {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const isShort = candidate.direction === "SHORT";
  const isEdgeAi = (candidate.signalSource ?? source) === "edgeai";
  if (!["LONG", "SHORT"].includes(candidate.direction)) blockers.push("Ogiltig eller okänd riktning.");
  if (!Number.isFinite(candidate.perf1m) || !Number.isFinite(candidate.rs3m)) {
    blockers.push("Trenddata perf1m/rs3m saknas eller är ogiltiga; ingen kvalificering.");
  }
  if (!isEdgeAi && (!Number.isFinite(candidate.rsi) || candidate.rsi < 0 || candidate.rsi > 100)) {
    blockers.push("RSI saknas eller ligger utanför 0–100.");
  }
  if (isEdgeAi && !hasVerifiedAtr({...candidate,signalSource:"edgeai"})) {
    warnings.push("ATR för underliggande är inte verifierad; EdgeAI-edgefält används inte som ATR.");
  } else if (!isEdgeAi && (typeof candidate.atr !== "number" || !Number.isFinite(candidate.atr) || candidate.atr <= 0)) {
    blockers.push("ATR saknas eller är ogiltig; ingen kvalificering.");
  }
  if (candidate.category === "STUDS" || candidate.category === "WEAKEST") {
    warnings.push("RESEARCH – modulen kräver oberoende verifierad netto-positiv expectancy före kvalificering.");
  }
  const reportDate = observedReportDate(candidate.signalDate, candidate.earningsInDays, candidate.earningsKnowledge);
  const report = reportWindow(reportDate, marketDate(now, candidate.market === "US" ? "US" : "SE"), candidate.market ?? "SE");
  if (report.blocked) blockers.push(`${report.status} – ingen TRADEABLE/READY; manuell observation bevaras.`);
  if (candidate.ticker) {
    try { resolveYahooTicker(candidate.ticker, candidate.market); }
    catch (error) { blockers.push(error instanceof Error ? error.message : "Kräver instrumentverifiering."); }
  }
  if ((candidate.signalSource ?? source) === "telegram" && candidate.category === "STUDS" &&
      Number.isFinite(candidate.rsi) && typeof candidate.pctB === "number" && Number.isFinite(candidate.pctB) &&
      candidate.rsi >= 35 && candidate.pctB >= 0) {
    blockers.push("Inkonsekvent Telegram-kategori STUDS: kräver RSI < 35 eller %B < 0; signalens rådata har bevarats.");
  }
  // Legacy EdgeAI imports stored expectancyR * 100 in `rsi`. Keep that
  // compatibility only for EdgeAI rows; new imports use edgeExpectancyR.
  const edgeExpectancyR = candidate.edgeExpectancyR != null
    ? candidate.edgeExpectancyR
    : candidate.rsi / 100;

  if (!Number.isFinite(candidate.volMultiplier) || candidate.volMultiplier <= 0) {
    blockers.push("Volymdata saknas — ingen kvalificerad trade.");
  } else if (!validMarketDate(candidate.volumeAsOf)) {
    blockers.push("Volymens avslutade kursdatum är inte verifierat — ingen kvalificerad trade.");
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

  if (!Number.isFinite(candidate.rr) || candidate.rr < 1.2) blockers.push("R:R saknas, är ogiltigt eller under miniminivån 1,2.");
  const actualRisk = Math.abs(candidate.entryPrice-candidate.stopPrice);
  const actualReward = isShort ? candidate.entryPrice-candidate.targetPrice : candidate.targetPrice-candidate.entryPrice;
  const actualRR = actualReward/actualRisk;
  if (!Number.isFinite(actualRR) || actualRisk<=0 || actualRR<1.2)
    blockers.push("Beräknat brutto-R/R från entry/stop/target är ogiltigt eller under 1,2.");
  if (isEdgeAi && edgeExpectancyR < 0 && !isShort) {
    blockers.push(`Negativ historisk förväntan (${edgeExpectancyR.toFixed(2)}R).`);
  }
  // Stored signal-time observations remain immutable; unknown dates fail closed.

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
  reasons.push(`Rapportkontroll: ${report.status} · observerat datum ${reportDate ?? "okänt"} · källa ${candidate.signalSource ?? source ?? "okänd"}.`);
  // Explicit user policy: negative expectancy alone may not block SHORT.
  // This is information, not a warning that would turn approval into WAIT.
  if (isEdgeAi && isShort && edgeExpectancyR < 0) {
    reasons.push(`SHORT tillåten trots negativ historisk förväntan (${edgeExpectancyR.toFixed(2)}R).`);
  }
  const qualification=candidateQualification(candidate,source,now,context);
  if(qualification.status==="BLOCKED")blockers.push(...qualification.reasons);
  else if(qualification.status!=="QUALIFIED")warnings.push(...qualification.reasons);
  return {status:statusFor(warnings,blockers),reasons:[...new Set([...reasons,...qualification.reasons])]};
}

/**
 * A trader-facing decision derived from the already persisted signal and its
 * review.  This deliberately does not infer whether a Yahoo request succeeded:
 * that provenance is not stored with legacy candidates.  It only reports
 * missing/invalid values that are actually present in the candidate record.
 */
export function screenCandidate(
  candidate: CandidateReviewInput & { price: number },
  review: SignalReview,
  sessionDate: string,
  now = new Date(),
  context:PolicyContext={},
): CandidateDecision {
  if (!candidate.signalDate) {
    return {
      status: "STALE",
      reasons: ["Signalen saknar verifierat källdatum — kontrollera en ny snapshot före trade.", ...review.reasons],
    };
  }
  const market = candidate.market === "US" ? "US" : "SE";
  if (!isAcceptedSignalDate(candidate.signalDate, sessionDate, market)) {
    return {
      status: "STALE",
      reasons: [`Källsignalen ${candidate.signalDate} ligger utanför tillåten fördröjning för ${sessionDate}; endast dagens eller föregående handelsdags rapport accepteras.`, ...review.reasons],
    };
  }
  if (
    candidate.signalSource === "edgeai" &&
    candidate.signalAgeBars != null &&
    candidate.maxHoldDays != null &&
    Number.isFinite(candidate.signalAgeBars) &&
    Number.isFinite(candidate.maxHoldDays) &&
    candidate.maxHoldDays > 0 &&
    candidate.signalAgeBars >= candidate.maxHoldDays
  ) {
    return {
      status: "STALE",
      reasons: [`EdgeAI-signalen har nått sin maxålder (${candidate.signalAgeBars}/${candidate.maxHoldDays} bars).`, ...review.reasons],
    };
  }
  const storedReport = observedReportDate(candidate.signalDate,candidate.earningsInDays,candidate.earningsKnowledge);
  const reportCheck = reportWindow(storedReport,marketDate(now,market),market);
  if (reportCheck.blocked) return {status:"BLOCKED",reasons:[reportCheck.status,...review.reasons]};

  const invalid: string[] = [];
  if (!Number.isFinite(candidate.price) || candidate.price <= 0) {
    invalid.push("Screenad kurs saknas eller är ogiltig.");
  }
  if (!Number.isFinite(candidate.volMultiplier) || candidate.volMultiplier <= 0) {
    invalid.push("Volymdata saknas eller är ogiltig.");
  } else if (!validMarketDate(candidate.volumeAsOf) || candidate.volumeAsOf > candidate.signalDate) {
    invalid.push("Volymens avslutade kursdatum saknas eller är ogiltigt.");
  }
  const isEdgeAi = (candidate.signalSource ?? null) === "edgeai";
  if (isEdgeAi) {
    const edgeExpectancyR = candidate.edgeExpectancyR != null
      ? candidate.edgeExpectancyR
      : candidate.rsi / 100;
    if (!Number.isFinite(edgeExpectancyR)) {
      invalid.push("Historisk EdgeAI-förväntan saknas eller är ogiltig.");
    }
  } else if (!Number.isFinite(candidate.rsi) || candidate.rsi < 0) {
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

  const today = marketDate(now, market);
  const referenceSession = signalSessionDate(now, market);
  if (candidate.signalDate > today || !(isAcceptedSignalDate(candidate.signalDate, today, market) ||
      isAcceptedSignalDate(candidate.signalDate, referenceSession, market)) ||
    sessionDate > referenceSession) {
    return {
      status: "STALE",
      reasons: [`Signalen är från ${candidate.signalDate}; kontrollera en ny snapshot och live-pris före trade.`, ...review.reasons],
    };
  }
  if (review.status === "BLOCKED") return { status: "BLOCKED", reasons: review.reasons };
  const qualification=candidateQualification(candidate,candidate.signalSource??null,now,context);
  if(qualification.status==="BLOCKED")return {status:"BLOCKED",reasons:[...qualification.reasons,...review.reasons]};
  if(qualification.status!=="QUALIFIED")return {status:"WAIT",reasons:[...qualification.reasons,...review.reasons]};
  if (review.status === "WARN") return { status: "WAIT", reasons: review.reasons };
  return {
    status: "TRADEABLE",
    reasons: [
      candidate.signalDate === sessionDate
        ? "Screeningsreglerna är godkända för dagens signal."
        : `Rapport från ${candidate.signalDate} accepteras med en handelsdags fördröjning. Kontrollera aktuell kurs före trade.`,
      ...review.reasons,
    ],
  };
}

/** Public decision is never an order authorization. Frozen screening uses
 * screenCandidate internally, so the board gate cannot erase historical cohorts.
 */
export function decideCandidate(candidate:CandidateReviewInput&{price:number},review:SignalReview,sessionDate:string,now=new Date(),context:PolicyContext={}):CandidateDecision {
  const screening=screenCandidate(candidate,review,sessionDate,now,context);
  return {status:screening.status==="TRADEABLE"?"WAIT":screening.status,
    reasons:[BOARD_REVIEW_REQUIRED+" – manuellt fempartsprotokoll och verifierat underlag krävs; inget ordergodkännande.",...screening.reasons]};
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