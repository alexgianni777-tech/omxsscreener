/** UI defence-in-depth for active AG Invest OMXS30 display.
 * Backend importers MUST still enforce official membership.
 * Keep aligned with api-server/src/lib/omxs30Scope.ts and Nasdaq rebalances.
 * Historical candidates remain visible only in explicitly opened archive.
 */
export const OMXS30_ACTIVE_FROM = "2026-11-23";
const NOVEMBER = new Set([
  "ABB.ST", "ADDT-B.ST", "ALFA.ST", "ASSA-B.ST", "AZN.ST",
  "ATCO-A.ST", "BOL.ST", "EPI-A.ST", "EQT.ST", "ERIC-B.ST",
  "ESSITY-B.ST", "EVO.ST", "HM-B.ST", "HEXA-B.ST", "INDU-C.ST",
  "INVE-B.ST", "LIFCO-B.ST", "NIBE-B.ST", "NDA-SE.ST", "SAAB-B.ST",
  "SAND.ST", "SEB-A.ST", "SKA-B.ST", "SKF-B.ST", "SCA-B.ST",
  "SHB-A.ST", "SWED-A.ST", "TEL2-B.ST", "TELIA.ST", "VOLV-B.ST",
]);
export function activeOmxs30Candidate(c: {
  market: string | null;
  ticker: string;
  sessionDate: string;
}): boolean {
  if (c.market !== "SE" || !/^\d{4}-\d{2}-\d{2}$/.test(c.sessionDate) ||
      c.sessionDate < OMXS30_ACTIVE_FROM) return false;
  const ticker = String(c.ticker || "").trim().toUpperCase().replace(/\s+/g, "-");
  const symbol = ticker.endsWith(".ST") ? ticker : ticker + ".ST";
  const members = new Set(NOVEMBER);
  if (c.sessionDate >= "2026-12-01") { members.delete("LIFCO-B.ST"); members.add("SOBI.ST"); }
  return members.has(symbol);
}
