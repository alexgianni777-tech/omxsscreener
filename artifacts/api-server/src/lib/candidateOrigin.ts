export type CandidateOrigin = "edgeai" | "legacy" | "manual";

/** Do not infer provenance for pre-tagging rows or the older "screener" source. */
export function candidateOrigin(
  stored: CandidateOrigin | null | undefined,
  signalSource: string | null | undefined,
): CandidateOrigin | null {
  if (stored != null) return stored;
  if (signalSource === "edgeai") return "edgeai";
  if (signalSource === "telegram") return "legacy";
  if (signalSource === "manual") return "manual";
  return null;
}