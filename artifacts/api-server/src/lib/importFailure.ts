import { db, screenerSessionsTable } from "@workspace/db";
import { desc, eq, lte } from "drizzle-orm";
import { lockScreenerSession } from "./candidateSynchronization";
import type { ImportReport } from "./importReport";

/** Record failure separately AFTER rollback; never register candidates or a successful receipt. */
export async function recordImportFailure(date: string, report: ImportReport, message: string) {
  await db.transaction(async tx => {
    await lockScreenerSession(tx, date);
    let [session] = await tx.select().from(screenerSessionsTable).where(eq(screenerSessionsTable.date, date));
    if (!session) {
      // Keep a rejected first delivery visible even when its report-date session
      // has not been created. Attach only the receipt to the newest prior
      // session; candidate rows, plans, and outcomes are never touched.
      [session] = await tx.select().from(screenerSessionsTable)
        .where(lte(screenerSessionsTable.date, date))
        .orderBy(desc(screenerSessionsTable.date))
        .limit(1);
      if (session) {
        await lockScreenerSession(tx, session.date);
        [session] = await tx.select().from(screenerSessionsTable)
          .where(eq(screenerSessionsTable.id, session.id));
      }
    }
    if (!session) return;
    const receipts = Array.isArray(session.sourceReports) ? session.sourceReports : [];
    if (receipts.some((row: any) => row.status === "FAILED" && row.fingerprint === report.fingerprint && row.error === message)) return;
    await tx.update(screenerSessionsTable).set({
      sourceReports: [...receipts, { ...report, status: "FAILED", error: message, importedAt: new Date().toISOString() }],
    }).where(eq(screenerSessionsTable.id, session.id));
  });
}
