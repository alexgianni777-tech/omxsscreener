import test from "node:test";
import assert from "node:assert/strict";
import { screenerSessionsTable, top3SelectionRevisionsTable } from "@workspace/db";
import { approveImportedTop3, readSavedTop3 } from "./persistentTop3";
function harness() {
  const report = { source: "edgeai", signalDate: "2026-10-09", fingerprint: "latest", status: "SUCCESS", importedAt: "2026-10-09T10:00:00Z" };
  const original = { id: 1, ticker: "TEST", category: "MOMENTUM", market: "SE", direction: "LONG",
    signalSource: "edgeai", signalDate: report.signalDate, entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2 };
  const version: any = { id: 1, revision: 2, displayEligible: false, available: true,
    createdAt: new Date(report.importedAt), sources: ["edgeai", "telegram"], inputs: [original],
    selections: [{ candidateId: 1, selected: true, rank: 1, score: 1, market: "SE", direction: "LONG", source: "edgeai", decision: {} }] };
  const writes: any[] = [];
  const tx: any = {
    select: () => ({ from: (table: any) => ({ where: () => {
      const rows = table === top3SelectionRevisionsTable ? [version] : [{ sourceReports: [report] }];
      const q: any = Promise.resolve(rows); q.orderBy = () => ({ limit: async () => rows }); return q;
    } }) }),
    update: (table: any) => ({ set: (value: any) => ({ where: async () => { writes.push({ table, value }); Object.assign(version, value); } }) }),
  };
  return { tx, version, report, writes, original };
}
test("saved Top 3 API identifies SE and US data dates separately without modifying stored evidence", async () => {
  const h = harness();
  const us = { ...h.original, id: 2, ticker: "ACME", market: "US" };
  const version = { ...h.version, sessionId: 1, displayEligible: true,
    inputs: [h.original, us], selections: [
      h.version.selections[0],
      { ...h.version.selections[0], candidateId: 2, ticker: "ACME", market: "US" },
    ] };
  const sessions = [{ id: 1, date: "2026-10-09", sourceReports: [
    { ...h.report, dataDates: { SE: "2026-10-08", US: "2026-10-07" } },
  ] }];
  const before = JSON.stringify({ sessions, version });
  const tx: any = { select: () => ({ from: (table: unknown) => {
    const rows = table === screenerSessionsTable ? sessions : table === top3SelectionRevisionsTable ? [version] : [];
    const result: any = Promise.resolve(rows);
    result.orderBy = () => result;
    return result;
  } }) };
  const result = await readSavedTop3(tx);
  assert.deepEqual(result.selection.dataDates, [
    { market: "SE", source: "edgeai", signalDate: "2026-10-09", dataDate: "2026-10-08" },
    { market: "US", source: "edgeai", signalDate: "2026-10-09", dataDate: "2026-10-07" },
  ]);
  assert.equal(JSON.stringify({ sessions, version }), before);
});
test("manual acceptance atomically approves only display metadata; original inputs/selections are untouched", async () => {
  const h = harness(), before = JSON.stringify({ inputs: h.version.inputs, selections: h.version.selections });
  await approveImportedTop3(h.tx, 1, h.report);
  assert.equal(h.version.displayEligible, true);
  assert.deepEqual(h.writes.map(w => w.value), [{ displayEligible: true }]);
  assert.equal(JSON.stringify({ inputs: h.version.inputs, selections: h.version.selections }), before);
});
test("older replay, empty/partial versions and failed reports never approve automatic data", async () => {
  for (const change of ["old", "empty", "partial", "failed"]) {
    const h = harness();
    if (change === "empty") h.version.selections = [];
    if (change === "partial") h.version.sources = ["edgeai"];
    if (change === "failed") h.report.status = "FAILED";
    await approveImportedTop3(h.tx, 1, { ...h.report, fingerprint: change === "old" ? "older" : "latest" });
    assert.equal(h.version.displayEligible, false, change);
    assert.equal(h.writes.length, 0);
  }
});
