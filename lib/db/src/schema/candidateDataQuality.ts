/** Source evidence, not a replacement for immutable screening/trade inputs. */
export type CandidateDataQuality = {
  source: string;
  dataAsOf: string | null;
  evidenceStatus: string | null;
  eliteStatus: string | null;
  eliteQualified: boolean | null;
  validatedEdge: boolean | null;
  barSource: "PROVIDER_DAILY" | "RECONSTRUCTED_INTRADAY" | "UNKNOWN";
  fullSessionVerified: boolean;
  entryEligible: boolean;
  reasons: string[];
};
