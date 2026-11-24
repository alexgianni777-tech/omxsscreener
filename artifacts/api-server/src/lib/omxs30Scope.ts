/**
 * Dated active universe for AG Invest.
 *
 * This is a safety gate for new proposals, not a filter for deleting or
 * rewriting historical rows. Keep the list aligned with official Nasdaq
 * Stockholm OMXS30 membership changes.
 */
export const OMXS30_SCOPE_START = "2026-11-23";
export const OMXS30_DECEMBER_REBALANCE = "2026-12-01";

const NOVEMBER_MEMBERS = [
  "ABB.ST", "ADDT-B.ST", "ALFA.ST", "ASSA-B.ST", "AZN.ST",
  "ATCO-A.ST", "BOL.ST", "EPI-A.ST", "EQT.ST", "ERIC-B.ST",
  "ESSITY-B.ST", "EVO.ST", "HM-B.ST", "HEXA-B.ST",
  "INDU-C.ST", "INVE-B.ST", "LIFCO-B.ST", "NIBE-B.ST",
  "NDA-SE.ST", "SAAB-B.ST", "SAND.ST", "SEB-A.ST", "SKA-B.ST",
  "SKF-B.ST", "SCA-B.ST", "SHB-A.ST", "SWED-A.ST",
  "TEL2-B.ST", "TELIA.ST", "VOLV-B.ST",
] as const;

const DECEMBER_MEMBERS = NOVEMBER_MEMBERS
  .filter((ticker) => ticker !== "LIFCO-B.ST")
  .concat("SOBI.ST");

const SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  "INVESTOR B": "INVE-B.ST",
  "LIFCO B": "LIFCO-B.ST",
  SOBI: "SOBI.ST",
};

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizedOmxs30Ticker(input: unknown): string | null {
  if (typeof input !== "string" || input.trim().length === 0) return null;
  const raw = input.trim().toUpperCase().replace(/\s+/g, " ");
  const alias = SYMBOL_ALIASES[raw];
  const symbol = alias ?? raw.replace(/ /g, "-");
  if (!/^[A-Z0-9-]+(?:\.ST)?$/.test(symbol)) return null;
  return symbol.endsWith(".ST") ? symbol : `${symbol}.ST`;
}

/** Returns the documented list for the supplied Stockholm decision date. */
export function omxs30Members(decisionDate: string): ReadonlySet<string> {
  if (!isIsoDate(decisionDate)) {
    throw new Error("A valid Stockholm decision date is required for OMXS30 validation");
  }
  return new Set(decisionDate < OMXS30_DECEMBER_REBALANCE ? NOVEMBER_MEMBERS : DECEMBER_MEMBERS);
}

/** Fail closed for US, unknown, and non-constituent symbols. */
export function eligibleAgInvestCandidate(
  market: unknown,
  ticker: unknown,
  decisionDate: string,
): boolean {
  if (market !== "SE" || decisionDate < OMXS30_SCOPE_START) return false;
  return omxs30Members(decisionDate).has(normalizedOmxs30Ticker(ticker) ?? "");
}
