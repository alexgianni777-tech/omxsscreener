import { db, screenerSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { lockScreenerSession } from "./candidateSynchronization";
import type { ImportReport } from "./importReport";

/** Record failure separately AFTER rollback; never register candidates or a successful receipt. */
export async function recordImportFailure(date: string, report: ImportReport, message: string) {
  await db.transaction(async tx => {
    await lockScreenerSession(tx, date);
    const [session] = await tx.select().from(screenerSessionsTable).where(eq(screenerSessionsTable.date, date));
    if (!session) return;
    const receipts = Array.isArray(session.sourceReports) ? session.sourceReports : [];
    if (receipts.some((row: any) => row.status === "FAILED" && row.fingerprint === report.fingerprint && row.error === message)) return;
    await tx.update(screenerSessionsTable).set({
      sourceReports: [...receipts, { ...report, status: "FAILED", error: message, importedAt: new Date().toISOString() }],
    }).where(eq(screenerSessionsTable.id, session.id));
  });
}
