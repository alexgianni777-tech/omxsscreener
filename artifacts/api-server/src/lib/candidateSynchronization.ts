import { and, eq, inArray, sql } from "drizzle-orm";

import { candidatesTable, screenerSessionsTable, top3SelectionSnapshotsTable, survivalTradesTable } from "@workspace/db";
import { logger } from "./logger";
import { candidateOrigin } from "./candidateOrigin";
import {
  candidateIdentity as policyCandidateIdentity,
  effectiveCandidateInputs,
  pendingRemovalIdentities,
  synchronizedSignalSource,
} from "./candidateSynchronizationPolicy";
import { top3CutoffForDate } from "./top3SelectionPolicyCore";

type CandidateInput = Record<string, unknown> & {
  market?: string | null;
  signalDate?: string | null;
  category: string;
  ticker: string;
  direction: string;
};

/**
 * A stable identity for an individual setup. Ticker alone is not enough: a
 * session can contain the same ticker in multiple categories, markets,
 * directions, or signal sources. A null source remains distinct as unknown
 * provenance; it is not inferred from a session or a later import.
 */
export function candidateIdentity(candidate: CandidateInput): string {
  return policyCandidateIdentity(candidate);
}

/** @deprecated Use deduplicateCandidates instead — no longer throws on duplicates. */
export function assertUniqueCandidateIdentities(_candidates: CandidateInput[]) {
  // kept for import compatibility; deduplication is now handled silently
}

/**
 * Remove duplicate candidates from an incoming batch, keeping the first
 * occurrence of each (market|category|ticker|direction|signalSource) identity.
 * Returns the deduplicated list and the identities that were skipped.
 */
export function deduplicateCandidates<T extends CandidateInput>(
  candidates: T[],
): { candidates: T[]; skipped: string[] } {
  const seen = new Set<string>();
  const result: T[] = [];
  const skipped: string[] = [];
  for (const candidate of candidates) {
    const identity = candidateIdentity(candidate);
    if (seen.has(identity)) {
      skipped.push(identity);
    } else {
      seen.add(identity);
      result.push(candidate);
    }
  }
  return { candidates: result, skipped };
}

/**
 * Merge a new import into an existing session without dropping candidates
 * from the other source. Incoming candidates come first, so an exact
 * source-aware identity match uses the latest import's values while
 * synchronization still preserves any already-recorded outcome.
 */
export function mergeCandidateInputs<T extends CandidateInput>(
  incoming: T[],
  existing: CandidateInput[],
): T[] {
  return effectiveCandidateInputs(incoming, existing);
}

/**
 * Machine reports can be partial. Preserve previously imported suggestions
 * even when a later report omits them; incoming identities still take priority.
 * Unlike the normal force-reimport policy, this cannot remove a pending row.
 */
export function preserveCandidateInputs<T extends CandidateInput>(
  incoming: T[],
  existing: CandidateInput[],
): T[] {
  const incomingIdentities = new Set(incoming.map(candidateIdentity));
  return [
    ...incoming,
    ...existing.filter((candidate) => !incomingIdentities.has(candidateIdentity(candidate))),
  ] as T[];
}

/**
 * Return the pending rows that synchronizeCandidates will delete for an
 * incoming batch. Keeping this calculation beside the writer is important:
 * conflict previews must not grow a subtly different notion of "effective"
 * input from the actual force-import.
 */
export function pendingCandidatesToRemove(
  existing: CandidateInput[],
  incoming: CandidateInput[],
  selectedCandidateIds: ReadonlySet<number> = new Set(),
): CandidateDiffEntry[] {
  const removedIdentities = new Set(
    pendingRemovalIdentities(existing, incoming),
  );
  return existing
    .filter((candidate: any) =>
      !selectedCandidateIds.has(candidate.id) &&
      removedIdentities.has(candidateIdentity(candidate)),
    )
    .map(toDiffEntry);
}

/** Business fields whose changes are worth surfacing in an import diff. Fields the
 * synchronization step always preserves outcome resolution fields and
 * isTop3Pick, so they are deliberately excluded — those never change on
 * re-import. */
const DIFF_TRACKED_FIELDS = [
  "entryPrice",
  "stopPrice",
  "targetPrice",
  "rr",
  "rsi",
  "volMultiplier",
  "volumeAsOf",
  "oneR",
  "rank",
  "distFrom20dH",
  "pctB",
  "atr",
  "perf1m",
  "rs3m",
  "gapWarning",
  "earningsInDays",
  "earningsKnowledge",
  "market",
  "signalSource",
  "origin",
  "edgeWinRate",
  "edgeExpectancyR",
  "edgeSampleN",
  "signalAgeBars",
  "maxHoldDays",
  "signalDate",
] as const;

export type CandidateDiffEntry = {
  identity: string;
  ticker: string;
  category: string;
  direction: string;
  market: string | null;
};

export type CandidateFieldChange = CandidateDiffEntry & {
  changes: { field: string; from: unknown; to: unknown }[];
};

export type CandidateSyncDiff = {
  added: CandidateDiffEntry[];
  updated: CandidateFieldChange[];
  removed: CandidateDiffEntry[];
};

function toDiffEntry(candidate: any): CandidateDiffEntry {
  return {
    identity: candidateIdentity(candidate),
    ticker: candidate.ticker,
    category: candidate.category,
    direction: candidate.direction,
    market: candidate.market ?? null,
  };
}

function diffFields(current: any, incoming: any): { field: string; from: unknown; to: unknown }[] {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const field of DIFF_TRACKED_FIELDS) {
    const from = current[field] ?? null;
    const to = incoming[field] ?? null;
    // Compare numerically-rounded values for floats so float-noise from re-fetches
    // (e.g. 102.850000001) doesn't manufacture spurious "changed" entries.
    const same =
      typeof from === "number" && typeof to === "number"
        ? Math.abs(from - to) < 0.005
        : from === to;
    if (!same) changes.push({ field, from, to });
  }
  return changes;
}

/**
 * Synchronize an imported candidate set without deleting recorded history.
 * PENDING candidates that disappear from an import are removed; resolved
 * candidates remain, so a partial upstream response cannot erase outcomes.
 *
 * Returns the final candidate list plus a diff describing exactly what this
 * import added, changed, or removed compared to what was there before.
 */
export async function synchronizeCandidates(
  tx: any,
  sessionId: number,
  incoming: CandidateInput[],
  now = new Date(),
): Promise<{ candidates: any[]; diff: CandidateSyncDiff }> {
  const { candidates: deduped, skipped } = deduplicateCandidates(incoming);
  if (skipped.length > 0) logger.warn({ skipped }, "Candidate synchronization skipped duplicate identities");
  incoming = deduped;

  const selectedSnapshotRows: Array<{ candidateId: number }> = await tx
    .select({ candidateId: top3SelectionSnapshotsTable.candidateId })
    .from(top3SelectionSnapshotsTable)
    .where(
      and(
        eq(top3SelectionSnapshotsTable.sessionId, sessionId),
        eq(top3SelectionSnapshotsTable.selected, true),
      ),
    );
  const selectedCandidateIds = new Set(selectedSnapshotRows.map((row) => row.candidateId));

  const [session] = await tx
    .select({
      date: screenerSessionsTable.date,
      top3SnapshotAt: screenerSessionsTable.top3SnapshotAt,
      top3CutoffEvaluatedAt: screenerSessionsTable.top3CutoffEvaluatedAt,
    })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, sessionId));
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const protectPreCutoffCohort =
    session?.date === today &&
    now.getTime() >= top3CutoffForDate(session.date).getTime() &&
    !session.top3SnapshotAt &&
    !session.top3CutoffEvaluatedAt;

  const existing: any[] = await tx
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, sessionId));
  const existingByIdentity = new Map<string, any>(
    existing.map((candidate) => [candidateIdentity(candidate), candidate]),
  );
  const linkedTrades: Array<{ candidateId: number }> = existing.length
    ? await tx.select({ candidateId: survivalTradesTable.sourceCandidateId })
      .from(survivalTradesTable)
      .where(inArray(survivalTradesTable.sourceCandidateId, existing.map((row) => row.id)))
    : [];
  const registeredCandidateIds = new Set(linkedTrades.map((row) => row.candidateId));
  const incomingIdentities = new Set(incoming.map(candidateIdentity));
  const protectedCandidateIds = new Set<number>();
  if (protectPreCutoffCohort && session) {
    const cutoff = top3CutoffForDate(session.date);
    for (const candidate of existing) {
      if (
        candidate.createdAt instanceof Date &&
        candidate.createdAt.getTime() < cutoff.getTime() &&
        candidate.signalDate === session.date &&
        (candidate.signalSource === "telegram" || candidate.signalSource === "edgeai")
      ) {
        protectedCandidateIds.add(candidate.id);
      }
    }
  }

  const diff: CandidateSyncDiff = { added: [], updated: [], removed: [] };

  for (const candidate of incoming) {
    const identity = candidateIdentity(candidate);
    const current = existingByIdentity.get(identity);
    const values: Record<string, unknown> = { ...candidate, sessionId };

    if (current) {
      // The first source row before the daily cutoff is the immutable cohort
      // input. A later import may not silently rewrite its signal-time fields.
      if (protectedCandidateIds.has(current.id)) continue;

      // The signal-time selection is immutable evidence. Do not let later
      // imports rewrite either its signal/plan fields or its identity fields.
      // Outcome updates remain handled by the dedicated outcome PATCH path.
      if (selectedCandidateIds.has(current.id)) continue;
      if (registeredCandidateIds.has(current.id) ||
        ["WIN", "LOSS", "TIME_EXIT", "SKIP"].includes(current.outcome)) continue;

      // A known source date is immutable. Legacy NULL means unknown and must
      // remain unknown rather than being retrospectively backfilled.
      if (current.signalDate == null) {
        values.signalDate = null;
      } else if (values.signalDate !== current.signalDate) {
        throw new Error(
          `Signal date mismatch for ${current.ticker}: stored ${current.signalDate}, incoming ${String(values.signalDate ?? "unknown")}`,
        );
      }
      // A later historical re-import has no way to recreate a signal-day
      // calendar. Do not replace an already recorded signal-time observation
      // with its deliberately UNKNOWN incoming counterpart.
      if (
        values.earningsKnowledge === "UNKNOWN" &&
        current.earningsKnowledge === "SIGNAL_TIME"
      ) {
        values.earningsInDays = current.earningsInDays;
        values.earningsKnowledge = current.earningsKnowledge;
        values.earningsObservedAt = current.earningsObservedAt;
      }
      const changes = diffFields(current, values);
      if (changes.length > 0) diff.updated.push({ ...toDiffEntry(candidate), changes });

      await tx
        .update(candidatesTable)
        .set({
          ...values,
          outcome: current.outcome,
          exitPrice: current.exitPrice,
          outcomeNotes: current.outcomeNotes,
          resolutionMethod: current.resolutionMethod,
          resolutionQuality: current.resolutionQuality,
          realizedR: current.realizedR,
          resolutionEntryPrice: current.resolutionEntryPrice,
          resolutionStopPrice: current.resolutionStopPrice,
          resolutionDirection: current.resolutionDirection,
          signalSource: synchronizedSignalSource(
            values.signalSource as string | null | undefined,
            current.signalSource,
          ),
          origin: candidateOrigin(
            current.origin,
            values.signalSource as string | null | undefined,
          ) ?? candidateOrigin(
            values.origin as "edgeai" | "legacy" | "manual" | null | undefined,
            values.signalSource as string | null | undefined,
          ),
          isTop3Pick: current.isTop3Pick,
        } as any)
        .where(eq(candidatesTable.id, current.id));
    } else {
      diff.added.push(toDiffEntry(candidate));
      // PostgreSQL now() is the transaction start, which can precede a wait
      // on the session lock. Use the wall clock when this INSERT actually runs
      // so a post-16:30 arrival cannot appear to have joined before cutoff.
      await tx.insert(candidatesTable).values({
        ...values,
        createdAt: sql`clock_timestamp()`,
      } as any);
    }
  }

  const stalePending = existing.filter(
    (candidate: any) =>
      candidate.outcome === "PENDING" &&
      !selectedCandidateIds.has(candidate.id) &&
      !registeredCandidateIds.has(candidate.id) &&
      !protectedCandidateIds.has(candidate.id) &&
      !incomingIdentities.has(candidateIdentity(candidate)),
  );
  const stalePendingIds = stalePending.map((candidate: any) => candidate.id);

  if (stalePendingIds.length > 0) {
    diff.removed = stalePending.map(toDiffEntry);
    await tx
      .delete(candidatesTable)
      .where(
        and(
          eq(candidatesTable.sessionId, sessionId),
          inArray(candidatesTable.id, stalePendingIds),
        ),
      );
  }

  const candidates = await tx
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, sessionId))
    .orderBy(candidatesTable.category, candidatesTable.rank);

  return { candidates, diff };
}

/** Serializes all writers for one calendar-day session across app processes. */
export async function lockScreenerSession(tx: any, date: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${date}))`);
}