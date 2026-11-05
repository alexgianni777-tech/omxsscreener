import type { CandidateDataQuality } from "@workspace/api-client-react";

export function sourceQualityReasons(source?: string | null, quality?: CandidateDataQuality | null): string[] {
  if (!quality) return source === "edgeai" ? ["Upstream-kvalificering okänd – ingen entrybekräftelse."] : [];
  if (source === "edgeai" && (quality.eliteQualified !== true || quality.validatedEdge !== true ||
    !quality.evidenceStatus || !quality.eliteStatus || quality.evidenceStatus === "WATCH" || quality.eliteStatus === "RESEARCH_ONLY")) {
    return quality.reasons.length ? quality.reasons : ["RESEARCH ONLY – upstream kvalificerar inte denna setup för entry."];
  }
  if (!quality.entryEligible || quality.barSource === "RECONSTRUCTED_INTRADAY" && !quality.fullSessionVerified) {
    return quality.reasons.length ? quality.reasons : ["Kursunderlagets kvalitet ej verifierad – ingen entrybekräftelse."];
  }
  return [];
}
