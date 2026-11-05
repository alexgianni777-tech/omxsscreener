import { desc, eq } from "drizzle-orm";
import { candidatesTable, screenerSessionsTable, top3SelectionRevisionsTable, top3SelectionSnapshotsTable } from "@workspace/db";
import { mapTop3Revision } from "./top3SelectionRevisions";
import { chooseSavedTop3, validDisplayPlan, validDisplayRevision } from "./persistentTop3Policy";

/** Manual/Telegram accepted import only; call within its existing locked transaction. */
export async function approveImportedTop3(tx: any, sessionId: number, report: { source: string; signalDate: string; fingerprint: string }) {
  const [session] = await tx.select({ sourceReports: screenerSessionsTable.sourceReports })
    .from(screenerSessionsTable).where(eq(screenerSessionsTable.id, sessionId));
  const receipt = [...(session?.sourceReports ?? [])].reverse().find((r: any) =>
    r.status !== "FAILED" && r.source === report.source);
  // A re-paste of an older already-seen report must not approve a different
  // automatic version that arrived afterwards.
  if (!receipt || receipt.fingerprint !== report.fingerprint || receipt.signalDate !== report.signalDate) return;
  const [latest] = await tx.select().from(top3SelectionRevisionsTable)
    .where(eq(top3SelectionRevisionsTable.sessionId, sessionId))
    .orderBy(desc(top3SelectionRevisionsTable.revision)).limit(1);
  if (!latest || !validDisplayRevision(mapTop3Revision(latest), true) ||
    (receipt.importedAt && (!Number.isFinite(Date.parse(receipt.importedAt)) ||
      latest.createdAt.getTime() < Date.parse(receipt.importedAt)))) return;
  await tx.update(top3SelectionRevisionsTable).set({ displayEligible: true })
    .where(eq(top3SelectionRevisionsTable.id, latest.id));
  // Historical frozen cohort remains a separate view, never rewritten here.
}

/** All reads use the caller's repeatable-read transaction. */
export async function readSavedTop3(tx: any) {
  const sessions = await tx.select().from(screenerSessionsTable).orderBy(desc(screenerSessionsTable.date));
  const revisions = await tx.select().from(top3SelectionRevisionsTable);
  const snapshots = await tx.select().from(top3SelectionSnapshotsTable);
  const candidates = await tx.select().from(candidatesTable);
  const byId = new Map<number, any>(candidates.map((c: any) => [c.id, c]));
  const choices: any[] = [];
  for (const session of sessions) {
    const dataDates = (revision: any) => revision.picks.map((p: any) => {
      const receipt = [...(session.sourceReports ?? [])].reverse().find((r: any) =>
        r.status !== "FAILED" && r.source === p.source && r.signalDate === p.signalDate &&
        r.importedAt && Date.parse(r.importedAt) <= Date.parse(revision.selectedAt));
      return { market: p.market, source: p.source ?? "unknown", signalDate: p.signalDate ?? null,
        // A setup trigger can predate the report. Use only this revision's
        // captured quality; never borrow a later import's market day.
        dataDate: p.dataQuality ? p.dataQuality.dataAsOf ?? null : receipt?.dataDates?.[p.market] ?? null };
    });
    for (const row of revisions.filter((r: any) => r.sessionId === session.id)) {
      const revision = mapTop3Revision(row);
      if (validDisplayRevision(revision)) choices.push({ sessionId: session.id, date: session.date,
        kind: "RECOMMENDATION", revision, dataDates: dataDates(revision) });
    }
    const selected = snapshots.filter((s: any) => s.sessionId === session.id && s.selected && s.displayEligible);
    if (selected.length && session.top3SnapshotAt) {
      const picks = selected.map((s: any) => {
        const c = byId.get(s.candidateId);
        return { candidateId: s.candidateId, ticker: s.ticker, category: s.category,
          signalDate: c?.signalDate ?? null, rank: s.rank, score: s.score, market: s.market ?? c?.market,
          direction: s.direction, source: s.source ?? c?.signalSource ?? "unknown", entryPrice: c?.entryPrice,
          stopPrice: c?.stopPrice, targetPrice: c?.targetPrice, rr: c?.rr, decision: s.decision, dataQuality: null };
      });
      if (picks.every(validDisplayPlan)) {
        const revision = { revision: 0, displayEligible: true, available: true,
          selectedAt: session.top3SnapshotAt.toISOString(), policyVersion: session.top3PolicyVersion ?? "legacy",
          sources: [...new Set(picks.map((p: any) => p.source))].filter(Boolean), picks };
        choices.push({ sessionId: session.id, date: session.date, kind: "OFFICIAL", revision,
          dataDates: dataDates(revision) });
      }
    }
  }
  const selection = chooseSavedTop3(choices);
  const latestSession = sessions[0];
  const latest = revisions.filter((r: any) => r.sessionId === latestSession?.id)
    .sort((a: any, b: any) => b.revision - a.revision)[0];
  const warnings: string[] = [];
  if (latestSession && (!selection || latestSession.date > selection.date))
    warnings.push(`Ny session ${latestSession.date}: ingen ny giltig sparad lista. Föregående giltiga urval behålls.`);
  if (latest && (!validDisplayRevision(mapTop3Revision(latest)) ||
    (selection?.sessionId === latestSession?.id && latest.revision > selection.revision.revision)))
    warnings.push("Senaste data/version är automatisk live-data, tom eller ofullständig. Den ersätter inte det sparade giltiga urvalet.");
  if ((latestSession?.sourceReports ?? []).some((r: any) => r.status === "FAILED"))
    warnings.push("Misslyckad import finns registrerad; tidigare giltigt urval behålls.");
  return { selection, warnings };
}
