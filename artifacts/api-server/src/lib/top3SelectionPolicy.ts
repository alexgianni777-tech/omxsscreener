import { eq } from "drizzle-orm";
import { screenerSessionsTable, top3SelectionSnapshotsTable } from "@workspace/db";
import {
  buildTop3SelectionSnapshot,
  TOP3_POLICY_VERSION,
  type PolicyCandidate,
} from "./top3SelectionPolicyCore";

export { buildTop3SelectionSnapshot, TOP3_POLICY_VERSION, TOP3_SELECTION_TYPE } from "./top3SelectionPolicyCore";

/**
 * Called only inside the creating import's existing per-session transaction
 * and advisory lock. The session timestamp is the manifest, so an empty
 * candidate set is still a completed snapshot and can never be filled in by a
 * later import.
 */
export async function snapshotNewSessionTop3(
  tx: any,
  session: { id: number; date: string; source: string | null },
  candidates: PolicyCandidate[],
): Promise<void> {
  const stockholmDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // A retrospective import is not point-in-time evidence. Leave the session
  // unsealed so a later real same-day source import can establish a snapshot.
  if (session.date !== stockholmDate) return;
  const knownSignalCandidates = candidates.filter(
    (candidate) => candidate.signalDate === session.date && Boolean(candidate.signalSource),
  );
  if (knownSignalCandidates.length === 0) return;

  const [storedSession] = await tx
    .select({ top3SnapshotAt: screenerSessionsTable.top3SnapshotAt })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, session.id));
  if (!storedSession || storedSession.top3SnapshotAt) return;

  const selectedAt = new Date();
  const rows = buildTop3SelectionSnapshot(
    knownSignalCandidates,
    session.id,
    session.date,
    session.source,
    selectedAt,
  );
  if (rows.length > 0) await tx.insert(top3SelectionSnapshotsTable).values(rows);
  await tx
    .update(screenerSessionsTable)
    .set({ top3SnapshotAt: selectedAt, top3PolicyVersion: TOP3_POLICY_VERSION })
    .where(eq(screenerSessionsTable.id, session.id));
}