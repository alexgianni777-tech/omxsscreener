/**
 * Frontend defence-in-depth for the active AG Invest universe.
 * Keep the dated list aligned with api-server/src/lib/omxs30Scope.ts.
 * This only controls display; server-side import validation remains authoritative.
 */
export const OMXS30_ACTIVE_FROM = "2026-11-23";
export const OMXS30_DECEMBER_REBALANCE = "2026-12-01";
export const SKF_VERTEVO_RESEARCH_START = "2026-11-26";
export const SKF_VERTEVO_RESEARCH_END = "2026-11-30";
export const SKF_VERTEVO_TICKER = "SKFVER-B.ST";
export const OMXS30_TOP3_POLICY_VERSION = "official-top3-v8-omxs30";

const NOVEMBER_MEMBERS = new Set([
  "ABB.ST", "ADDT-B.ST", "ALFA.ST", "ASSA-B.ST", "AZN.ST",
  "ATCO-A.ST", "BOL.ST", "EPI-A.ST", "EQT.ST", "ERIC-B.ST",
  "ESSITY-B.ST", "EVO.ST", "HM-B.ST", "HEXA-B.ST", "INDU-C.ST",
  "INVE-B.ST", "LIFCO-B.ST", "NIBE-B.ST", "NDA-SE.ST", "SAAB-B.ST",
  "SAND.ST", "SEB-A.ST", "SKA-B.ST", "SKF-B.ST", "SCA-B.ST",
  "SHB-A.ST", "SWED-A.ST", "TEL2-B.ST", "TELIA.ST", "VOLV-B.ST",
]);

const DECEMBER_MEMBERS = new Set([
  ...[...NOVEMBER_MEMBERS].filter((ticker) => ticker !== "LIFCO-B.ST"),
  "SOBI.ST",
]);

const SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  "INVESTOR B": "INVE-B.ST",
  "INVE B": "INVE-B.ST",
  "LIFCO B": "LIFCO-B.ST",
  SOBI: "SOBI.ST",
};

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeTicker(value: string): string | null {
  const raw = value.trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const alias = SYMBOL_ALIASES[raw];
  const symbol = alias ?? raw.replace(/ /g, "-");
  if (!/^[A-Z0-9-]+(?:\.ST)?$/.test(symbol)) return null;
  return symbol.endsWith(".ST") ? symbol : `${symbol}.ST`;
}

export type Omxs30CandidateIdentity = {
  market?: string | null;
  ticker: string;
  sessionDate: string;
};

/** Membership is checked against the candidate's decision/session date. */
export function activeOmxs30Candidate(candidate: Omxs30CandidateIdentity): boolean {
  if (
    candidate.market !== "SE" ||
    !validIsoDate(candidate.sessionDate) ||
    candidate.sessionDate < OMXS30_ACTIVE_FROM
  ) return false;

  const ticker = normalizeTicker(candidate.ticker);
  if (!ticker) return false;
  const members = candidate.sessionDate < OMXS30_DECEMBER_REBALANCE
    ? NOVEMBER_MEMBERS
    : DECEMBER_MEMBERS;
  return members.has(ticker);
}

export function isOmxs30ResearchOnlyCandidate(candidate: Omxs30CandidateIdentity): boolean {
  if (
    candidate.market !== "SE" ||
    !validIsoDate(candidate.sessionDate) ||
    candidate.sessionDate < SKF_VERTEVO_RESEARCH_START ||
    candidate.sessionDate > SKF_VERTEVO_RESEARCH_END
  ) return false;
  return normalizeTicker(candidate.ticker) === SKF_VERTEVO_TICKER;
}

export function filterActiveOmxs30Candidates<T extends Omxs30CandidateIdentity>(candidates: readonly T[]): T[] {
  return candidates.filter(activeOmxs30Candidate);
}

/** Archive is the complement of today's dated OMXS30-eligible view; rows are never deleted. */
export function filterArchivedCandidates<T extends Omxs30CandidateIdentity>(candidates: readonly T[]): T[] {
  return candidates.filter((candidate) => !activeOmxs30Candidate(candidate));
}

export type Omxs30Top3PickIdentity = {
  market?: string | null;
  ticker: string;
};

export function filterActiveOmxs30Picks<T extends Omxs30Top3PickIdentity>(
  picks: readonly T[],
  sessionDate: string,
): T[] {
  return picks.filter((pick) => activeOmxs30Candidate({ ...pick, sessionDate }));
}

export function filterArchivedOmxs30Picks<T extends Omxs30Top3PickIdentity>(
  picks: readonly T[],
  sessionDate: string,
): T[] {
  return picks.filter((pick) => !activeOmxs30Candidate({ ...pick, sessionDate }));
}
