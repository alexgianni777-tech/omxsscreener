import assert from "node:assert/strict";
import test from "node:test";
import { latestSourceReceipts } from "./sourceReportStatus";

const receipt = (source: string, status: "SUCCESS" | "FAILED", importedAt: string, fingerprint: string) => ({
  source, status, importedAt, fingerprint, reportDate: importedAt.slice(0, 10),
  signalDate: importedAt.slice(0, 10), generatedAt: null,
  dataDates: { SE: null, US: null },
});

test("source health retains latest success and latest failure independently for each source", () => {
  const reports = latestSourceReceipts([
    { sourceReports: [receipt("edgeai", "SUCCESS", "2026-10-29T08:00:00Z", "e1")] },
    { sourceReports: [receipt("telegram", "SUCCESS", "2026-10-29T08:05:00Z", "t1")] },
    { sourceReports: [receipt("edgeai", "FAILED", "2026-10-30T08:00:00Z", "e2")] },
    { sourceReports: [receipt("telegram", "FAILED", "2026-10-30T08:05:00Z", "t2")] },
    { sourceReports: [receipt("edgeai", "SUCCESS", "2026-10-31T08:00:00Z", "e3")] },
  ]);
  assert.deepEqual(reports.map(report => `${report.source}:${report.status}:${report.fingerprint}`), [
    "telegram:SUCCESS:t1", "edgeai:FAILED:e2", "telegram:FAILED:t2", "edgeai:SUCCESS:e3",
  ]);
});
