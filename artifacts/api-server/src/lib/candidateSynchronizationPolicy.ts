export type CandidatePolicyInput = {
  market?: string | null;
  category: string;
  ticker: string;
  direction: string;
};

export function candidateIdentity(candidate: CandidatePolicyInput): string {
  return [
    candidate.market ?? "SE",
    candidate.category,
    candidate.ticker.trim().toUpperCase(),
    candidate.direction,
  ].join("|");
}

/** Preserve only rows from markets not represented by this import. */
export function effectiveCandidateInputs<T extends CandidatePolicyInput>(
  incoming: T[],
  existing: CandidatePolicyInput[],
): T[] {
  const incomingIdentities = new Set(incoming.map(candidateIdentity));
  const incomingMarkets = new Set(incoming.map((candidate) => candidate.market ?? "SE"));
  return [
    ...incoming,
    ...existing.filter(
      (candidate) =>
        !incomingIdentities.has(candidateIdentity(candidate)) &&
        !incomingMarkets.has(candidate.market ?? "SE"),
    ),
  ] as T[];
}

export function pendingRemovalIdentities(
  existing: Array<CandidatePolicyInput & { outcome?: string }>,
  incoming: CandidatePolicyInput[],
): string[] {
  const effectiveIdentities = new Set(
    effectiveCandidateInputs(incoming, existing).map(candidateIdentity),
  );
  return existing
    .filter(
      (candidate) =>
        candidate.outcome === "PENDING" &&
        !effectiveIdentities.has(candidateIdentity(candidate)),
    )
    .map(candidateIdentity);
}

export function synchronizedSignalSource(
  incoming: string | null | undefined,
  current: string | null | undefined,
): string | null {
  return incoming ?? current ?? null;
}

export function aggregateSessionSource(
  current: string | null | undefined,
  candidateSources: Array<string | null | undefined>,
): string | null {
  if (current === "mixed") return "mixed";
  const provenances = new Set(candidateSources.filter((source): source is string => Boolean(source)));
  if (provenances.size > 1) return "mixed";
  return provenances.values().next().value ?? current ?? null;
}

export function legacySignalSourceForSession(
  sessionSource: string | null | undefined,
): string | null {
  if (sessionSource === "edgeai" || sessionSource === "telegram") return sessionSource;
  if (sessionSource == null || sessionSource === "manual" || sessionSource === "screener") {
    return "manual";
  }
  return null;
}