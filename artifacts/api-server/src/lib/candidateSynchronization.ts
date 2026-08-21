import { and, eq, inArray, sql } from "drizzle-orm";

import { candidatesTable } from "@workspace/db";

type CandidateInput = Record<string, unknown> & {
  market?: string | null;
  category: string;
  ticker: string;
  direction: string;
};

/**
 * A stable identity for an individual setup. Ticker alone is not enough: a
 * session can contain the same ticker in multiple categories, markets or
 * directions.
 */
export function candidateIdentity(candidate: CandidateInput): string {
  return [
    candidate.market ?? "SE",
    candidate.category,
    candidate.ticker.trim().toUpperCase(),
    candidate.direction,
  ].join("|");
}

/** @deprecated Use deduplicateCandidates instead — no longer throws on duplicates. */
export function assertUniqueCandidateIdentities(_candidates: CandidateInput[]) {
  // kept for import compatibility; deduplication is now handled silently
}

/**
 * Remove duplicate candidates from an incoming batch, keeping the first
 * occurrence of each (market|category|ticker|direction) identity.
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
 * Synchronize an imported candidate set without deleting recorded history.
 * PENDING candidates that disappear from an import are removed; resolved
 * candidates remain, so a partial upstream response cannot erase outcomes.
 */
export async function synchronizeCandidates(
  tx: any,
  sessionId: number,
  incoming: CandidateInput[],
) {
  const { candidates: deduped, skipped } = deduplicateCandidates(incoming);
  if (skipped.length > 0) {
    console.warn(`[sync] Skipped duplicate candidates: ${skipped.join(", ")}`);
  }
  incoming = deduped;

  const existing: any[] = await tx
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, sessionId));
  const existingByIdentity = new Map<string, any>(
    existing.map((candidate) => [candidateIdentity(candidate), candidate]),
  );
  const incomingIdentities = new Set(incoming.map(candidateIdentity));

  for (const candidate of incoming) {
    const identity = candidateIdentity(candidate);
    const current = existingByIdentity.get(identity);
    const values = { ...candidate, sessionId };

    if (current) {
      await tx
        .update(candidatesTable)
        .set({
          ...values,
          outcome: current.outcome,
          exitPrice: current.exitPrice,
          outcomeNotes: current.outcomeNotes,
          isTop3Pick: current.isTop3Pick,
        } as any)
        .where(eq(candidatesTable.id, current.id));
    } else {
      await tx.insert(candidatesTable).values(values as any);
    }
  }

  const stalePendingIds = existing
    .filter(
      (candidate: any) =>
        candidate.outcome === "PENDING" &&
        !incomingIdentities.has(candidateIdentity(candidate)),
    )
    .map((candidate: any) => candidate.id);

  if (stalePendingIds.length > 0) {
    await tx
      .delete(candidatesTable)
      .where(
        and(
          eq(candidatesTable.sessionId, sessionId),
          inArray(candidatesTable.id, stalePendingIds),
        ),
      );
  }

  return tx
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, sessionId))
    .orderBy(candidatesTable.category, candidatesTable.rank);
}

/** Serializes all writers for one calendar-day session across app processes. */
export async function lockScreenerSession(tx: any, date: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${date}))`);
}