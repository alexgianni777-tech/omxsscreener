/** Active AG Invest scope: only dated official OMXS30 constituents may create NEW proposals.
 * Past portfolio rows, USA track records and frozen snapshots remain read-only history.
 * Official Nasdaq fact sheet 2026-11-02; Sobi enters and Lifco exits 2026-12-01.
 * Temporary SKF Vertevo 2026-11-26..30 is explicitly research-only until enough OHLC/OOS.
 */
export const OMXS30_SCOPE_START = "2026-11-23" as const;
export const OMXS30_NOVEMBER = [
  "ABB.ST", "ADDT-B.ST", "ALFA.ST", "ASSA-B.ST", "AZN.ST",
  "ATCO-A.ST", "BOL.ST", "EPI-A.ST", "EQT.ST", "ERIC-B.ST",
  "ESSITY-B.ST", "EVO.ST", "HM-B.ST", "HEXA-B.ST",
  "INDU-C.ST", "INVE-B.ST", "LIFCO-B.ST", "NIBE-B.ST",
  "NDA-SE.ST", "SAAB-B.ST", "SAND.ST", "SEB-A.ST", "SKA-B.ST",
  "SKF-B.ST", "SCA-B.ST", "SHB-A.ST", "SWED-A.ST",
  "TEL2-B.ST", "TELIA.ST", "VOLV-B.ST",
] as const;

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T12:00:00Z")) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
}
export function omxs30Members(decisionDate: string): ReadonlySet<string> {
  if (!validIsoDate(decisionDate)) throw new Error("Verified trading decision date required");
  const tickers = OMXS30_NOVEMBER.map(t =>
    decisionDate >= "2026-12-01" && t === "LIFCO-B.ST" ? "SOBI.ST" : t,
  );
  return new Set(tickers);
}
export function normalizedOmxs30Ticker(input: unknown): string | null {
  if (typeof input !== "string" || input.trim().length === 0) return null;
  const candidate = input.trim().toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9-]+(?:\.ST)?$/.test(candidate)) return null;
  return candidate.endsWith(".ST") ? candidate : candidate + ".ST";
}
export function eligibleAgInvestCandidate(
  market: unknown,
  ticker: unknown,
  decisionDate: string,
): boolean {
  return market === "SE" &&
    omxs30Members(decisionDate).has(normalizedOmxs30Ticker(ticker) ?? "");
}
export function requireOmxs30ForNewProposal(
  market: unknown, ticker: unknown, decisionDate: string,
): void {
  if (!eligibleAgInvestCandidate(market, ticker, decisionDate))
    throw new Error("AG_INVEST_SCOPE_OMXS30_ONLY: outside official index; no new proposal");
}
