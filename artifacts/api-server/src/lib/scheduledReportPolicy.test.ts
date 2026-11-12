import test from "node:test";
import assert from "node:assert/strict";
import { alreadyAcceptedReport } from "./scheduledReportPolicy";
import { makeImportReport } from "./importReport";
test("D-1 successful fingerprint skips reimport; new version, failed receipt and different source do not", () => {
  const report = makeImportReport("edgeai", "2026-10-07", { entry: 100 }, null, { SE: "2026-10-06", US: null });
  const before = JSON.stringify(report);
  assert.ok(alreadyAcceptedReport([report], report, "2026-10-08"));
  assert.ok(!alreadyAcceptedReport([{ ...report, status: "FAILED" }], report, "2026-10-08"));
  assert.ok(!alreadyAcceptedReport([{ ...report, source: "telegram" }], report, "2026-10-08"));
  assert.ok(!alreadyAcceptedReport([report], makeImportReport("edgeai", "2026-10-07", { entry: 101 }), "2026-10-08"));
  assert.ok(!alreadyAcceptedReport([report], makeImportReport("edgeai", "2026-10-08", { entry: 100 }), "2026-10-08"));
  assert.equal(JSON.stringify(report), before);
});
test("weekend D-1 accepted; older/future/unknown dates fail closed, holidays never guessed", () => {
  const friday = makeImportReport("edgeai", "2026-10-09", {});
  assert.ok(alreadyAcceptedReport([friday], friday, "2026-10-12"));
  assert.ok(!alreadyAcceptedReport([friday], friday, "2026-10-13"));
  assert.ok(!alreadyAcceptedReport([friday], friday, "2026-10-08"));
  assert.ok(!alreadyAcceptedReport(null, friday, "2026-10-12"));
  assert.ok(!alreadyAcceptedReport([friday], { ...friday, signalDate: "" }, "2026-10-12"));
});
