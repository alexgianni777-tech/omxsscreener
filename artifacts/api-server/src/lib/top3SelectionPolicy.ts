import { and, eq, isNull } from "drizzle-orm";
import { candidatesTable, screenerSessionsTable, top3SelectionSnapshotsTable } from "@workspace/db";
import {
  buildTop3SelectionSnapshot,
  isTop3CutoffDue,
  TOP3_POLICY_VERSION,
  TOP3_REQUIRED_SOURCES,
  top3CutoffForDate,
  type PolicyCandidate,
} from "./top3SelectionPolicyCore";

export { buildTop3SelectionSnapshot, TOP3_POLICY_VERSION, TOP3_SELECTION_TYPE } from "./top3SelectionPolicyCore";

/**
 * Called inside a per-session transaction and advisory lock. Before 16:30
 * Stockholm it is intentionally a no-op. At/after cutoff it evaluates the
 * immutable createdAt cohort once; an incomplete source set remains unavailable.
 */
export async function snapshotNewSessionTop3(
  tx: any,
  session: { id: number; date: string; source: string | null },
  _candidates: PolicyCandidate[],
  now = new Date(),
): Promise<void> {
  const stockholmDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (session.date !== stockholmDate || !isTop3CutoffDue(session.date, now)) return;

  const [storedSession] = await tx
    .select({
      top3SnapshotAt: screenerSessionsTable.top3SnapshotAt,
      top3CutoffEvaluatedAt: screenerSessionsTable.top3CutoffEvaluatedAt,
    })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, session.id));
  // Legacy snapshots remain intact and are not retroactively assigned cohort
  // metadata. A new evaluation (successful or unavailable) is also terminal.
  if (!storedSession || storedSession.top3SnapshotAt || storedSession.top3CutoffEvaluatedAt) return;

  const cutoff = top3CutoffForDate(session.date);
  const arrivals: any[] = await tx
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, session.id));
  const cohort = arrivals.filter((candidate: any) =>
    candidate.createdAt instanceof Date &&
    candidate.createdAt.getTime() < cutoff.getTime() &&
    candidate.signalDate === session.date &&
    (candidate.signalSource === "telegram" || candidate.signalSource === "edgeai"),
  );
  const participatingSources = [...new Set(
    cohort.map((candidate) => candidate.signalSource as (typeof TOP3_REQUIRED_SOURCES)[number]),
  )].sort();

  const sourceComplete = TOP3_REQUIRED_SOURCES.every((source) => participatingSources.includes(source));
  const [claimed] = await tx
    .update(screenerSessionsTable)
    .set({
      ...(sourceComplete
        ? { top3SnapshotAt: now, top3PolicyVersion: TOP3_POLICY_VERSION }
        : {}),
      top3CutoffAt: cutoff,
      top3CutoffEvaluatedAt: now,
      top3ParticipatingSources: participatingSources,
    })
    .where(and(
      eq(screenerSessionsTable.id, session.id),
      isNull(screenerSessionsTable.top3CutoffEvaluatedAt),
    ))
    .returning({ id: screenerSessionsTable.id });
  // The conditional row update is the atomic seal claim. The transaction-level
  // session advisory lock also serializes all app writers for this date.
  if (!claimed) return;

  if (sourceComplete) {
    const rows = buildTop3SelectionSnapshot(
      cohort,
      session.id,
      session.date,
      session.source,
      now,
    );
    if (rows.length > 0) await tx.insert(top3SelectionSnapshotsTable).values(rows);
  }
}