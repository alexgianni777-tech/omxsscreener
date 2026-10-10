import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { top3SelectionRevisionsTable } from "@workspace/db";
import { candidateIdentity } from "./candidateSynchronizationPolicy";
import { isAcceptedSignalDate } from "./signalDatePolicy";
import { buildTop3SelectionSnapshot, TOP3_POLICY_VERSION, TOP3_REQUIRED_SOURCES, type PolicyCandidate, type SnapshotInput } from "./top3SelectionPolicyCore";

const SIGNAL_FIELDS = [
  "id", "ticker", "category", "rank", "market", "direction", "signalSource", "signalDate",
  "price", "perf1m", "rs3m", "rsi", "pctB", "distFrom20dH", "edgeExpectancyR",
  "edgeSampleN", "signalAgeBars", "maxHoldDays", "signalRsi", "signalGapPct",
  "volMultiplier", "volumeAsOf", "earningsInDays", "earningsKnowledge",
  "entryPrice", "stopPrice", "targetPrice", "rr", "createdAt",
] as const;

/**
 * Fresh recommendations are separate from candidate rows used for actual trades.
 * Replace the imported source/market scopes, retaining the other source's latest
 * inputs, not its older frozen candidate plan. IDs and signal dates stay authoritative.
 */
export function buildRevisionInputs(
  persisted: any[], incoming: any[], previous: unknown[] | undefined,
  date: string, now: Date,
  replacedSources: string[] = [],
): PolicyCandidate[] {
  const byIdentity = new Map(persisted.map((row) => [candidateIdentity(row), row]));
  const scope = (row: any) => `${row.signalSource}|${row.market ?? "SE"}`;
  const fresh = incoming.filter((row) => TOP3_REQUIRED_SOURCES.includes(row.signalSource));
  const replacedScopes = new Set(fresh.map(scope));
  for (const source of new Set([...replacedSources, ...fresh.map((row) => row.signalSource)])) {
    if (source === "edgeai") {
      replacedScopes.add("edgeai|SE");
      replacedScopes.add("edgeai|US");
    } else if (source === "telegram") replacedScopes.add("telegram|SE");
  }
  const prior = (previous ?? persisted) as any[];
  const updated = [
    ...prior.filter((row) => !replacedScopes.has(scope(row)) && byIdentity.has(candidateIdentity(row))),
    ...fresh.flatMap((row) => {
      const stored = byIdentity.get(candidateIdentity(row));
      if (!stored) return [];
      return [{
        ...stored, ...row, id: stored.id, createdAt: stored.createdAt,
        signalDate: stored.signalDate,
      }];
    }),
  ];
  const unique = new Map<string, any>();
  for (const row of updated) {
    const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    if (!isAcceptedSignalDate(row.signalDate, date) || !TOP3_REQUIRED_SOURCES.includes(row.signalSource) ||
      !Number.isFinite(createdAt.getTime()) || createdAt > now) continue;
    unique.set(candidateIdentity(row), Object.fromEntries(
      SIGNAL_FIELDS.map((field) => [field, field === "createdAt" ? createdAt.toISOString() : row[field] ?? null]),
    ));
  }
  return [...unique.values()].sort((a, b) => a.id - b.id);
}

/** Called under the same session lock and transaction as every import. */
export async function appendTop3Revision(
  tx: any, session: { id: number; date: string; source: string | null },
  persisted: any[], incoming: any[], now: Date,
  replacedSources: string[] = [],
  displayEligible = true,
): Promise<void> {
  const [previous] = await tx.select().from(top3SelectionRevisionsTable)
    .where(eq(top3SelectionRevisionsTable.sessionId, session.id))
    .orderBy(desc(top3SelectionRevisionsTable.revision)).limit(1);
  const inputs = buildRevisionInputs(persisted, incoming, previous?.inputs, session.date, now, replacedSources);
  const sources = [...new Set(inputs.map((row) => row.signalSource!))].sort();
  const available = TOP3_REQUIRED_SOURCES.every((source) => sources.includes(source));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ policy: TOP3_POLICY_VERSION, inputs })).digest("hex");
  if (previous?.fingerprint === fingerprint || (inputs.length === 0 && !previous)) return;
  const selections = available
    ? buildTop3SelectionSnapshot(inputs, session.id, session.date, session.source, now)
    : [];
  await tx.insert(top3SelectionRevisionsTable).values({
    sessionId: session.id, revision: (previous?.revision ?? 0) + 1,
    fingerprint, policyVersion: TOP3_POLICY_VERSION, available, sources, displayEligible,
    inputs, selections, createdAt: now,
  }).onConflictDoNothing();
}

export function mapTop3Revision(row: typeof top3SelectionRevisionsTable.$inferSelect) {
  const inputs = new Map((row.inputs as PolicyCandidate[]).map((input) => [input.id, input]));
  return {
    revision: row.revision, available: row.available,
    displayEligible: row.displayEligible,
    selectedAt: row.createdAt.toISOString(), policyVersion: row.policyVersion,
    sources: row.sources,
    picks: (row.selections as SnapshotInput[])
      .filter((selection) => selection.selected)
      .map((selection) => {
        const input = inputs.get(selection.candidateId)!;
        return {
          candidateId: input.id, ticker: input.ticker, category: input.category,
          signalDate: input.signalDate!,
          rank: selection.rank!, score: selection.score,
          market: selection.market!, direction: selection.direction, source: selection.source!,
          entryPrice: input.entryPrice, stopPrice: input.stopPrice,
          targetPrice: input.targetPrice, rr: input.rr, decision: selection.decision,
        };
      }),
  };
}