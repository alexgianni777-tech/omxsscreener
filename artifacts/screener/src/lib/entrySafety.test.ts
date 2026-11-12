import test from "node:test";
import assert from "node:assert/strict";
import { chaseWarnings, calendarAge, actualQuoteAge } from "./entrySafety";
import { assessLiveEntry } from "./liveEntryGuard";
const plan = { direction: "LONG", entryPrice: 100, stopPrice: 95, targetPrice: 110 }, now = Date.parse("2026-10-02T12:00:00Z");
const quote = { livePrice: 100.5, asOf: "2026-10-02T11:59:00Z", marketState: "REGULAR" };
test("chase adds a nonblocking warning even within entry zone; original READY and plans remain unchanged", () => {
  const before = JSON.stringify(plan);
  const a = chaseWarnings(plan, quote, now);
  assert.equal(a.assessment.status, "READY"); assert.ok(a.warnings.some(w => w.includes("passerat")));
  assert.deepEqual(a.assessment, assessLiveEntry(plan, quote, now));
  assert.equal(JSON.stringify(plan), before);
});
test("long/short chasing and R/R below 1.2 warn; passed stop/target and missing/stale/closed quote remain unverifiable", () => {
  const short = { direction: "SHORT", entryPrice: 100, stopPrice: 105, targetPrice: 90 };
  for (const [p, price] of [[plan, 102], [short, 98]] as const) {
    const a = chaseWarnings(p, { ...quote, livePrice: price }, now);
    assert.ok(a.warnings.some(w => w.includes("passerat"))); assert.ok(a.warnings.some(w => w.includes("1,2")));
  }
  for (const q of [null, { livePrice: 100 }, { ...quote, marketState: "CLOSED" }, { ...quote, asOf: "2026-10-02T11:50:00Z" },
    { ...quote, livePrice: 95 }, { ...quote, livePrice: 110 }]) assert.ok(chaseWarnings(plan, q, now).warnings.length);
});
test("calendar age respects D-1/weekends without imposing trading rules; actual asOf age never uses fetch time", () => {
  assert.equal(calendarAge("2026-10-09", "2026-10-12"), 3);
  assert.equal(calendarAge("2026-10-13", "2026-10-12"), -1);
  assert.equal(calendarAge("2026-02-30", "2026-10-12"), null);
  assert.equal(calendarAge(null, "2026-10-12"), null);
  assert.equal(actualQuoteAge(quote, now), 1);
  assert.equal(actualQuoteAge({ livePrice: 100 }, now), null);
  assert.equal(actualQuoteAge({ ...quote, asOf: "2026-10-03T12:00:00Z" }, now), null);
});
