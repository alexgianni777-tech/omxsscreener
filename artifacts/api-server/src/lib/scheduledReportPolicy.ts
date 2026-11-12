import { isAcceptedSignalDate } from "./signalDatePolicy";
import type { ImportReport } from "./importReport";
export function alreadyAcceptedReport(receipts: unknown, report: ImportReport, sessionDate: string): boolean {
  return isAcceptedSignalDate(report.signalDate, sessionDate) && Array.isArray(receipts) &&
    receipts.some(r => r?.status !== "FAILED" && r?.source === report.source &&
      r?.fingerprint === report.fingerprint && r?.signalDate === report.signalDate);
}
