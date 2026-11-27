import { activeOmxs30Candidate } from "./omxs30ActiveView";

export type PortfolioScopeIdentity = {
  ticker: string;
  market?: string | null;
  underlyingTicker?: string | null;
};

export function activeOmxs30PortfolioPosition(
  position: PortfolioScopeIdentity,
  decisionDate: string,
): boolean {
  return activeOmxs30Candidate({
    ticker: position.underlyingTicker?.trim() || position.ticker,
    market: position.market,
    sessionDate: decisionDate,
  });
}

export function partitionPortfolioPositions<T extends PortfolioScopeIdentity>(
  positions: readonly T[],
  decisionDate: string,
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const position of positions) {
    (activeOmxs30PortfolioPosition(position, decisionDate) ? active : archived).push(position);
  }
  return { active, archived };
}

export type JournalScopeRecord = { input: { candidateId: number } };
export type JournalScopeCandidate = {
  id: number;
  ticker: string;
  market?: string | null;
  sessionDate: string;
};

export function partitionOmxs30JournalRecords<T extends JournalScopeRecord>(
  records: readonly T[],
  candidates: readonly JournalScopeCandidate[],
): { active: T[]; archived: T[] } {
  const activeIds = new Set(
    candidates
      .filter(candidate => activeOmxs30Candidate(candidate))
      .map(candidate => candidate.id),
  );
  const active: T[] = [];
  const archived: T[] = [];
  for (const record of records) {
    (activeIds.has(record.input.candidateId) ? active : archived).push(record);
  }
  return { active, archived };
}
