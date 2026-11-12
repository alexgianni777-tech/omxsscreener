import { db, screenerSessionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { GitHubFetchError } from "./githubContents";
import type { ImportReport } from "./importReport";

export function activeSourceBackoff(receipts: Array<ImportReport & { importedAt?: string }>, now = Date.now()) {
  const history = receipts.filter(r => r.source === "edgeai").sort((a, b) =>
    Date.parse(b.importedAt ?? "") - Date.parse(a.importedAt ?? ""));
  const latest = history.find(r => r.status === "SUCCESS" || r.status === "FAILED");
  return latest?.status === "FAILED" && Date.parse(latest.retryAt ?? "") > now ? latest : null;
}

/** Persisted cooldown also applies after Autoscale wakes/restarts. No extra polling. */
export async function respectStoredEdgeAiBackoff(): Promise<void> {
  const sessions = await db.select({ sourceReports: screenerSessionsTable.sourceReports })
    .from(screenerSessionsTable).orderBy(desc(screenerSessionsTable.date)).limit(3);
  const receipt = activeSourceBackoff(sessions.flatMap(s => Array.isArray(s.sourceReports) ? s.sourceReports : []));
  if (receipt?.retryAt) throw new GitHubFetchError(
    receipt.error ?? `GitHub-backoff till ${receipt.retryAt}`, receipt.httpStatus ?? null, receipt.retryAt,
  );
}

export function attachFetchDiagnostic(report: ImportReport, error: unknown): void {
  if (error instanceof GitHubFetchError) {
    report.httpStatus = error.status;
    report.retryAt = error.retryAt;
  }
}
