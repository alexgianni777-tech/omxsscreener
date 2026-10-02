export type DiagnosticDecision = {
  status: string;
  reasons?: string[];
} | null | undefined;

export type TodayDiagnosticCandidate = {
  id: number;
  ticker: string;
  direction: string;
  market: string | null;
  signalSource: string | null;
  signalDate?: string | null;
  createdAt?: string | null;
  decision?: DiagnosticDecision;
  officialSelection?: {
    selected: boolean;
    source: string | null;
    market: string | null;
    direction: string;
    decision?: DiagnosticDecision;
  } | null;
};

export type DiagnosticLiveSelection = {
  evaluatedAt: string;
  cutoffAt: string | null;
  previewAvailable: boolean;
  sourceReceipts?: {
    edgeai?: { received: boolean; candidateCount?: number };
    telegram?: { received: boolean; candidateCount?: number };
  };
  picks: Array<{
    candidateId: number;
    market: string;
    direction: string;
    signalSource: string;
  }>;
};

export type DiagnosticFrozenSelection = {
  available: boolean;
  state?: string;
  cutoffAt?: string | null;
  participatingSources?: string[] | null;
  requiredSources?: string[];
  unavailableReason?: string | null;
} | null | undefined;

type DirectionTotals = {
  total: number;
  tradeable: number;
  wait: number;
  blocked: number;
  invalid: number;
  stale: number;
  conflict: number;
};

export type SourceMarketTotals = {
  source: "edgeai" | "telegram";
  market: "SE" | "US";
  total: number;
  LONG: DirectionTotals;
  SHORT: DirectionTotals;
  raw: { invalid: number; stale: number; conflict: number };
};

export type SelectedCounts = Record<string, number>;

export type SelectionDiagnostics = {
  available: boolean;
  reason: string | null;
  selectedCounts: SelectedCounts | null;
};

export type ShortSelectionIssue = {
  issueId: string;
  mode: "preliminary" | "official";
  market: "SE" | "US";
  eligibleShortCount: number;
  eligibleSources: string[];
};

export type TodayDiagnostics = {
  groups: SourceMarketTotals[];
  outsideMainCounts: Array<{ source: string; market: string; count: number }>;
  outsideSelectedCounts: Array<{
    source: string;
    market: string;
    direction: string;
    preliminary: number | null;
    official: number | null;
  }>;
  sourceReceipts: Array<{ source: string; received: boolean; candidateCount: number | null }>;
  sourceState: "none" | "partial" | "received" | "unavailable";
  shortImported: number;
  tradeableShort: number;
  topShortBlockingReasons: Array<{ reason: string; candidateCount: number }>;
  preliminary: SelectionDiagnostics;
  official: SelectionDiagnostics;
  issues: ShortSelectionIssue[];
};

const SOURCES = ["edgeai", "telegram"] as const;
const MARKETS = ["SE", "US"] as const;
const DIRECTIONS = ["LONG", "SHORT"] as const;
const RAW_STATUS_KEYS = ["INVALID", "STALE", "CONFLICT"] as const;
const NON_BLOCKING_SHORT_REASON_PREFIXES = [
  "SHORT tillåten trots negativ historisk förväntan",
  "Låg relativ volym (",
  "Regel 7 ej bedömbar:",
  "Target ligger ",
] as const;

function emptyDirectionTotals(): DirectionTotals {
  return { total: 0, tradeable: 0, wait: 0, blocked: 0, invalid: 0, stale: 0, conflict: 0 };
}

function emptyGroup(source: "edgeai" | "telegram", market: "SE" | "US"): SourceMarketTotals {
  return {
    source,
    market,
    total: 0,
    LONG: emptyDirectionTotals(),
    SHORT: emptyDirectionTotals(),
    raw: { invalid: 0, stale: 0, conflict: 0 },
  };
}

function displayStatusBucket(status: string | undefined): "tradeable" | "wait" | "blocked" | null {
  if (status === "TRADEABLE") return "tradeable";
  if (status === "WAIT" || status === "STALE") return "wait";
  if (status === "BLOCKED" || status === "INVALID" || status === "CONFLICT") return "blocked";
  return null;
}

function selectionKey(source: string, market: string, direction: string): string {
  return `${source}:${market}:${direction}`;
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\.ST$/, "");
}

function withoutOpposingTickerConflicts<T extends { ticker: string; direction: string }>(candidates: T[]): T[] {
  const tickerDirections = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const ticker = normalizeTicker(candidate.ticker);
    const directions = tickerDirections.get(ticker) ?? new Set<string>();
    directions.add(candidate.direction);
    tickerDirections.set(ticker, directions);
  }
  const conflicting = new Set(
    [...tickerDirections.entries()]
      .filter(([, directions]) => directions.has("LONG") && directions.has("SHORT"))
      .map(([ticker]) => ticker),
  );
  return candidates.filter((candidate) => !conflicting.has(normalizeTicker(candidate.ticker)));
}

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function uniqueCandidateReasons(reasons: string[] | undefined): Array<{ key: string; label: string }> {
  const seen = new Set<string>();
  const unique: Array<{ key: string; label: string }> = [];
  for (const reason of reasons ?? []) {
    const label = reason.trim();
    if (!label) continue;
    if (NON_BLOCKING_SHORT_REASON_PREFIXES.some((prefix) => label.startsWith(prefix))) continue;
    const key = label.replace(/\s+/g, " ").toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ key, label });
  }
  return unique;
}

export function deriveTodayDiagnostics(input: {
  sessionDate: string;
  today: string;
  candidates: TodayDiagnosticCandidate[];
  live?: DiagnosticLiveSelection | null;
  frozen?: DiagnosticFrozenSelection;
  now: number;
}): TodayDiagnostics | null {
  if (input.sessionDate !== input.today) return null;

  const groups = new Map<string, SourceMarketTotals>();
  for (const source of SOURCES) {
    for (const market of MARKETS) groups.set(selectionKey(source, market, ""), emptyGroup(source, market));
  }
  const outside = new Map<string, number>();
  const shortReasons = new Map<string, { reason: string; candidateIds: Set<number> }>();
  let shortImported = 0;
  let tradeableShort = 0;

  for (const candidate of input.candidates) {
    const source = candidate.signalSource;
    const market = candidate.market;
    if ((source === "edgeai" || source === "telegram") && (market === "SE" || market === "US")) {
      const group = groups.get(selectionKey(source, market, ""))!;
      group.total++;
      const status = candidate.decision?.status;
      if (status && RAW_STATUS_KEYS.includes(status as (typeof RAW_STATUS_KEYS)[number])) {
        const rawKey = status.toLocaleLowerCase() as "invalid" | "stale" | "conflict";
        group.raw[rawKey]++;
      }
      if (candidate.direction === "LONG" || candidate.direction === "SHORT") {
        const direction = group[candidate.direction];
        direction.total++;
        const bucket = displayStatusBucket(status);
        if (bucket) direction[bucket]++;
        if (status === "INVALID") direction.invalid++;
        if (status === "STALE") direction.stale++;
        if (status === "CONFLICT") direction.conflict++;
      }
    } else {
      const sourceLabel = source || "okänd källa";
      const marketLabel = market || "okänd marknad";
      const key = `${sourceLabel}::${marketLabel}`;
      outside.set(key, (outside.get(key) ?? 0) + 1);
    }

    if (candidate.direction === "SHORT" && (source === "edgeai" || source === "telegram") &&
      (market === "SE" || market === "US")) {
      shortImported++;
      if (candidate.decision?.status === "TRADEABLE") tradeableShort++;
    }

    if (candidate.direction === "SHORT" && candidate.signalDate === input.sessionDate &&
      (source === "edgeai" || source === "telegram") &&
      (market === "SE" || market === "US") &&
      ["BLOCKED", "INVALID", "CONFLICT"].includes(candidate.decision?.status ?? "")) {
      // The server's flat decision.reasons array can include non-blocking review warnings too.
      for (const { key, label } of uniqueCandidateReasons(candidate.decision?.reasons)) {
        const item = shortReasons.get(key) ?? { reason: label, candidateIds: new Set<number>() };
        item.candidateIds.add(candidate.id);
        shortReasons.set(key, item);
      }
    }
  }

  const live = input.live ?? null;
  const now = input.now;
  const cutoffAt = validTime(live?.cutoffAt);
  const liveEvaluatedAt = validTime(live?.evaluatedAt);
  const preliminaryAvailable = Boolean(live?.previewAvailable && (cutoffAt == null || now < cutoffAt));
  const preliminaryCounts: SelectedCounts | null = preliminaryAvailable ? {} : null;
  if (preliminaryAvailable && live) {
    for (const pick of live.picks) {
      const key = selectionKey(pick.signalSource, pick.market, pick.direction);
      preliminaryCounts![key] = (preliminaryCounts![key] ?? 0) + 1;
    }
  }

  const frozen = input.frozen;
  const officialAvailable = frozen?.available === true;
  const officialSourcesComplete = SOURCES.every((source) =>
    frozen?.participatingSources?.includes(source) === true &&
    (!frozen.requiredSources || frozen.requiredSources.includes(source)));
  const officialCutoff = validTime(frozen?.cutoffAt);
  const arrivedByOfficialCutoff = (candidate: TodayDiagnosticCandidate) => {
    const createdAt = validTime(candidate.createdAt);
    return officialCutoff == null || createdAt == null || createdAt <= officialCutoff;
  };
  const officialCounts: SelectedCounts | null = officialAvailable ? {} : null;
  if (officialAvailable) {
    for (const candidate of input.candidates) {
      const selection = candidate.officialSelection;
      if (!selection?.selected) continue;
      const key = selectionKey(
        selection.source || "okänd källa",
        selection.market || "okänd marknad",
        selection.direction,
      );
      officialCounts![key] = (officialCounts![key] ?? 0) + 1;
    }
  }

  const issues: ShortSelectionIssue[] = [];
  if (preliminaryAvailable && live) {
    const observedCandidates = input.candidates.filter((candidate) =>
      candidate.signalDate === input.sessionDate &&
      (candidate.direction === "LONG" || candidate.direction === "SHORT") &&
      (candidate.signalSource === "edgeai" || candidate.signalSource === "telegram") &&
      (candidate.market === "SE" || candidate.market === "US") &&
      candidate.decision?.status === "TRADEABLE" &&
      (liveEvaluatedAt == null || validTime(candidate.createdAt) == null ||
        validTime(candidate.createdAt)! <= liveEvaluatedAt),
    );
    const eligibleShorts = withoutOpposingTickerConflicts(observedCandidates)
      .filter((candidate) => candidate.direction === "SHORT");
    for (const market of MARKETS) {
      const marketEligible = eligibleShorts.filter((candidate) => candidate.market === market);
      const selectedShorts = live.picks.filter((pick) => pick.market === market && pick.direction === "SHORT").length;
      if (marketEligible.length > 0 && selectedShorts === 0) {
        issues.push({
          issueId: `${input.sessionDate}:preliminary:${market}`,
          mode: "preliminary",
          market,
          eligibleShortCount: marketEligible.length,
          eligibleSources: [...new Set(marketEligible.map((candidate) => candidate.signalSource!))].sort(),
        });
      }
    }
  }

  if (officialAvailable && officialSourcesComplete) {
    const frozenCandidates = input.candidates.filter((candidate) => {
      const selection = candidate.officialSelection;
      return selection != null &&
        (selection.source === "edgeai" || selection.source === "telegram") &&
        (selection.market === "SE" || selection.market === "US") &&
        (selection.direction === "LONG" || selection.direction === "SHORT") &&
        candidate.signalDate === input.sessionDate &&
        selection.decision?.status === "TRADEABLE" &&
        arrivedByOfficialCutoff(candidate);
    }).map((candidate) => ({
      ticker: candidate.ticker,
      direction: candidate.officialSelection!.direction,
      market: candidate.officialSelection!.market!,
      source: candidate.officialSelection!.source!,
    }));
    const eligibleShorts = withoutOpposingTickerConflicts(frozenCandidates)
      .filter((candidate) => candidate.direction === "SHORT");
    for (const market of MARKETS) {
      const marketEligible = eligibleShorts.filter((candidate) => candidate.market === market);
      const selectedShorts = input.candidates.filter((candidate) =>
        candidate.officialSelection?.selected === true &&
        candidate.officialSelection.market === market &&
        candidate.officialSelection.direction === "SHORT" &&
        arrivedByOfficialCutoff(candidate),
      ).length;
      if (marketEligible.length > 0 && selectedShorts === 0) {
        issues.push({
          issueId: `${input.sessionDate}:official:${market}`,
          mode: "official",
          market,
          eligibleShortCount: marketEligible.length,
          eligibleSources: [...new Set(marketEligible.map((candidate) => candidate.source))].sort(),
        });
      }
    }
  }

  const receipts = live?.sourceReceipts;
  const sourceReceipts = SOURCES.map((source) => ({
    source,
    received: receipts?.[source]?.received === true,
    candidateCount: typeof receipts?.[source]?.candidateCount === "number"
      ? receipts[source].candidateCount!
      : null,
  }));
  const sourceState = !receipts
    ? "unavailable"
    : sourceReceipts.every((receipt) => !receipt.received)
      ? "none"
      : sourceReceipts.every((receipt) => receipt.received)
        ? "received"
        : "partial";

  const officialReason = officialAvailable
    ? null
    : frozen?.state === "MISSING_SOURCES"
      ? "Officiellt urval ej tillgängligt: källor saknades vid frysningen."
      : frozen?.unavailableReason ?? "Officiellt urval ej tillgängligt.";
  const preliminaryReason = preliminaryAvailable
    ? null
    : live?.previewAvailable && cutoffAt != null && now >= cutoffAt
      ? "Preliminärt urval ej tillgängligt efter bryttiden."
      : live
        ? "Inget utvärderat preliminärt urval tillgängligt."
        : "Preliminärt urval ej tillgängligt.";

  const outsideSelectedKeys = new Set(
    [...Object.keys(preliminaryCounts ?? {}), ...Object.keys(officialCounts ?? {})]
      .filter((key) => {
        const [source, market] = key.split(":");
        return !((source === "edgeai" || source === "telegram") &&
          (market === "SE" || market === "US"));
      }),
  );

  return {
    groups: [...groups.values()],
    outsideMainCounts: [...outside.entries()].map(([key, count]) => {
      const [source, market] = key.split("::");
      return { source, market, count };
    }).sort((a, b) => a.source.localeCompare(b.source) || a.market.localeCompare(b.market)),
    outsideSelectedCounts: [...outsideSelectedKeys].map((key) => {
      const [source, market, direction] = key.split(":");
      return {
        source,
        market,
        direction,
        preliminary: preliminaryAvailable ? preliminaryCounts?.[key] ?? 0 : null,
        official: officialAvailable ? officialCounts?.[key] ?? 0 : null,
      };
    }).sort((a, b) =>
      a.source.localeCompare(b.source) ||
      a.market.localeCompare(b.market) ||
      a.direction.localeCompare(b.direction)),
    sourceReceipts,
    sourceState,
    shortImported,
    tradeableShort,
    topShortBlockingReasons: [...shortReasons.values()]
      .map(({ reason, candidateIds }) => ({ reason, candidateCount: candidateIds.size }))
      .sort((a, b) => b.candidateCount - a.candidateCount || a.reason.localeCompare(b.reason))
      .slice(0, 5),
    preliminary: {
      available: preliminaryAvailable,
      reason: preliminaryReason,
      selectedCounts: preliminaryCounts,
    },
    official: {
      available: officialAvailable,
      reason: officialReason,
      selectedCounts: officialCounts,
    },
    issues,
  };
}