import test from "node:test";
import assert from "node:assert/strict";
import { assessLiveEntry, LIVE_ENTRY_MAX_PRICE_AGE_MS, type EntryPlan } from "./liveEntryGuard";

const now = Date.parse("2026-10-02T12:00:00Z");
const quote = (price: number, extra = {}) => ({
  livePrice: price, asOf: new Date(now - 60_000).toISOString(), marketState: "REGULAR", ...extra,
});
const long: EntryPlan = { direction: "LONG", entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2 };
const short: EntryPlan = { direction: "SHORT", entryPrice: 100, stopPrice: 105, targetPrice: 90, rr: 2 };

test("long and short near entry are READY with correctly recalculated R/R", () => {
  const a = assessLiveEntry(long, quote(101), now);
  const b = assessLiveEntry(short, quote(99), now);
  for (const entry of [a, b]) {
    assert.equal(entry.status, "READY");
    assert.equal(entry.originalRr, 2);
    assert.equal(entry.liveRr, 9 / 6);
    assert.equal(entry.driftR, 0.2);
  }
});
test("late long and short entries are MISSED_ENTRY", () => {
  for (const [plan, price] of [[long, 102], [short, 98]] as const) {
    const entry = assessLiveEntry(plan, quote(price), now);
    assert.equal(entry.status, "MISSED_ENTRY");
    assert.equal(entry.liveRr, 8 / 7);
  }
});
test("equal or passed stop/target breaks both directions", () => {
  for (const [plan, prices] of [[long, [95, 94, 110, 111]], [short, [105, 106, 90, 89]]] as const) {
    for (const price of prices) {
      const entry = assessLiveEntry(plan, quote(price), now);
      assert.equal(entry.status, "PLAN_BROKEN");
      assert.equal(entry.liveRr, null);
      assert.match(entry.reason, /stop|target/);
    }
  }
});
test("old actual asOf is stale even when fetchedAt is now", () => {
  const entry = assessLiveEntry(long, quote(100, {
    asOf: new Date(now - LIVE_ENTRY_MAX_PRICE_AGE_MS - 1).toISOString(),
    fetchedAt: new Date(now).toISOString(),
  }), now);
  assert.equal(entry.status, "STALE_PRICE");
  assert.equal(entry.liveRr, null);
});
test("closed/pre/post market never gives live R/R or READY", () => {
  for (const marketState of ["CLOSED", "PRE", "POST"]) {
    const entry = assessLiveEntry(short, quote(100, { marketState }), now);
    assert.equal(entry.status, "STALE_PRICE");
    assert.equal(entry.liveRr, null);
  }
});
test("missing/invalid/future asOf, unknown market and quote failure are UNKNOWN", () => {
  for (const extra of [
    { asOf: null }, { asOf: "invalid" }, { asOf: new Date(now + 120_000).toISOString() },
    { marketState: null }, { error: "unavailable" }, { livePrice: null }, { livePrice: NaN },
  ]) {
    const entry = assessLiveEntry(long, quote(100, extra), now);
    assert.equal(entry.status, "UNKNOWN");
    assert.equal(entry.liveRr, null);
  }
  assert.equal(assessLiveEntry(long, undefined, now).status, "UNKNOWN");
});
test("a price before the entry zone is not an entry confirmation", () => {
  for (const [plan, price] of [[long, 98], [short, 102]] as const) {
    assert.equal(assessLiveEntry(plan, quote(price), now).status, "UNKNOWN");
  }
});
test("even a small drift fails if remaining R/R is below 1.2", () => {
  const plan = { ...long, targetPrice: 106, rr: 1.2 };
  assert.equal(assessLiveEntry(plan, quote(100.1), now).status, "MISSED_ENTRY");
});
test("invalid plan is unknown, and inputs including historical status are untouched", () => {
  assert.equal(assessLiveEntry({ ...long, stopPrice: 101 }, quote(100), now).status, "UNKNOWN");
  const plan = Object.freeze({ ...short, status: "TRADEABLE", outcome: "WIN" });
  const input = Object.freeze(quote(99));
  const before = JSON.stringify({ plan, input });
  assessLiveEntry(plan, input, now);
  assert.equal(JSON.stringify({ plan, input }), before);
  assert.equal(plan.status, "TRADEABLE");
  assert.equal(plan.outcome, "WIN");
});
test("freshness and entry-zone boundaries are inclusive", () => {
  assert.equal(assessLiveEntry(long, quote(101.25, {
    asOf: new Date(now - LIVE_ENTRY_MAX_PRICE_AGE_MS).toISOString(),
  }), now).status, "READY");
  assert.equal(assessLiveEntry(short, quote(98.75), now).status, "READY");
});
