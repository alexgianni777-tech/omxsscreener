import test from "node:test";
import assert from "node:assert/strict";
import { chooseSavedTop3, validDisplayPlan, validDisplayRevision } from "./persistentTop3Policy";
const pick = { entryPrice: 100, stopPrice: 95, targetPrice: 110, direction: "LONG" };
const good = { available: true, displayEligible: true, sources: ["edgeai", "telegram"], picks: [pick] };
test("saved display requires complete sources, nonempty valid plans and explicit non-auto eligibility", () => {
  assert.ok(validDisplayRevision(good));
  for (const patch of [{ picks: [] }, { available: false }, { sources: ["edgeai"] }, { displayEligible: false },
    { picks: [{ ...pick, stopPrice: 105 }] }]) assert.equal(validDisplayRevision({ ...good, ...patch }), false);
  assert.ok(validDisplayPlan({ direction: "SHORT", entryPrice: 260.10, stopPrice: 267.54, targetPrice: 245.22 }));
});
test("date rollover, weekend and holiday cannot erase the last saved list; newer empty/partial/auto versions never take over", () => {
  const old = { date: "2026-10-09", revision: { ...good, selectedAt: "2026-10-09T14:00:00Z" } };
  const rows = [old, ...[{ picks: [] }, { sources: ["edgeai"] }, { displayEligible: false }].map(p => ({
    date: "2026-10-12", revision: { ...good, ...p, selectedAt: "2026-10-12T09:00:00Z" },
  }))];
  const before = JSON.stringify(rows);
  assert.deepEqual(chooseSavedTop3(rows.filter(r => validDisplayRevision(r.revision))), old);
  assert.equal(JSON.stringify(rows), before);
  const fresh = { date: "2026-10-12", revision: { ...good, selectedAt: "2026-10-12T10:00:00Z" } };
  assert.deepEqual(chooseSavedTop3([old, fresh]), fresh);
  assert.deepEqual(chooseSavedTop3([fresh, old]), fresh);
  assert.equal(chooseSavedTop3([]), null);
});
