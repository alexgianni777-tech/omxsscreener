import type { ImportReport } from "./importReport";

type StoredReceipt = ImportReport & { importedAt?: string | null };
type StoredSession = { sourceReports?: unknown };

function timestamp(receipt: StoredReceipt): number {
  const time = typeof receipt.importedAt === "string" ? Date.parse(receipt.importedAt) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Return each source's most recent success and failure, ordered as attempts. */
export function latestSourceReceipts(sessions: readonly StoredSession[]): StoredReceipt[] {
  const receipts = sessions.flatMap(session =>
    Array.isArray(session.sourceReports)
      ? session.sourceReports.filter((receipt): receipt is StoredReceipt =>
          !!receipt && typeof receipt === "object" &&
          ((receipt as StoredReceipt).source === "edgeai" || (receipt as StoredReceipt).source === "telegram") &&
          ((receipt as StoredReceipt).status === "SUCCESS" || (receipt as StoredReceipt).status === "FAILED"))
      : [],
  );
  const output: StoredReceipt[] = [];
  for (const source of ["telegram", "edgeai"] as const) {
    const history = receipts.filter(receipt => receipt.source === source).sort((a, b) => timestamp(a) - timestamp(b));
    const success = [...history].reverse().find(receipt => receipt.status === "SUCCESS");
    const failure = [...history].reverse().find(receipt => receipt.status === "FAILED");
    for (const receipt of [success, failure].filter((value): value is StoredReceipt => !!value)) {
      if (!output.some(existing => existing.source === receipt.source &&
        existing.status === receipt.status && existing.fingerprint === receipt.fingerprint &&
        existing.importedAt === receipt.importedAt)) output.push(receipt);
    }
  }
  return output.sort((a, b) => timestamp(a) - timestamp(b));
}
