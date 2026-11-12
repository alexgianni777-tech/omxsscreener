import type { CandidateDataQuality } from "@workspace/api-client-react";

/** Explicit positive source evidence for tests of independent entry conditions. */
export const qualifiedEdgeQuality: CandidateDataQuality = {
  source: "edgeai", dataAsOf: "2026-11-03", evidenceStatus: "VALIDATED",
  eliteStatus: "ELITE", eliteQualified: true, validatedEdge: true,
  barSource: "UNKNOWN", fullSessionVerified: false, entryEligible: true, reasons: [],
};
