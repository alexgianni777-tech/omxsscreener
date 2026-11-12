import test from "node:test";
import assert from "node:assert/strict";
import { createImportCheckCoordinator } from "./importCheckCoordinator";
import { alreadyAcceptedReport } from "./scheduledReportPolicy";
import { makeImportReport } from "./importReport";

test("wake, startup, timer and webhook share an in-flight check and five-minute budget", async () => {
  let now = 0;
  let runs = 0;
  let finish!: (v: string) => void;
  const check = createImportCheckCoordinator(() => {
    runs++;
    return new Promise<string>(resolve => { finish = resolve; });
  }, 300_000, () => now);
  const first = check();
  assert.equal(check(), first);
  await Promise.resolve();
  assert.equal(runs, 1);
  finish("committed");
  assert.equal(await first, "committed");
  now = 299_999;
  assert.equal(await check(), "committed");
  assert.equal(runs, 1);
  now = 300_000;
  const next = check();
  await Promise.resolve();
  finish("unchanged");
  assert.equal(await next, "unchanged");
  assert.equal(runs, 2);
});

test("failed checks do not form a hot retry loop; they retry after the normal interval", async () => {
  let now = 0;
  let runs = 0;
  const check = createImportCheckCoordinator(async () => {
    if (++runs === 1) throw new Error("transient");
    return "recovered";
  }, 300_000, () => now);
  await assert.rejects(check(), /transient/);
  await assert.rejects(check(), /transient/);
  assert.equal(runs, 1);
  now = 300_000;
  assert.equal(await check(), "recovered");
});

test("process restart uses durable receipts, not an in-memory imported flag; Telegram does not block EdgeAI", async () => {
  const report = makeImportReport("edgeai", "2026-10-23", { entry: 100 });
  const receipts = [makeImportReport("telegram", "2026-10-23", { entry: 80 })];
  let writes = 0;
  const importLatest = async () => {
    if (alreadyAcceptedReport(receipts, report, "2026-10-26")) return "unchanged";
    receipts.push(report);
    writes++;
    return "imported";
  };
  assert.equal(await createImportCheckCoordinator(importLatest, 300_000)(), "imported");
  assert.equal(await createImportCheckCoordinator(importLatest, 300_000)(), "unchanged");
  assert.equal(writes, 1);
  assert.equal(receipts[0].source, "telegram");
});
