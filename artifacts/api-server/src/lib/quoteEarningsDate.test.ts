import assert from "node:assert/strict";
import test from "node:test";
import { quoteEarningsDate } from "./quoteEarningsDate";

test("Swedish report later the same local day is zero days away", () => {
  assert.deepEqual(quoteEarningsDate(new Date("2026-11-06T18:00:00Z"), "BOL.ST",
    new Date("2026-11-06T08:00:00Z")), { earningsDate: "2026-11-06", earningsInDays: 0 });
});
test("US after-close report remains today across UTC midnight", () => {
  assert.deepEqual(quoteEarningsDate(new Date("2026-11-07T01:00:00Z"), "AAPL",
    new Date("2026-11-06T18:00:00Z")), { earningsDate: "2026-11-06", earningsInDays: 0 });
});
test("same instant can belong to different Swedish and US calendar days", () => {
  const event = new Date("2026-11-07T00:30:00Z");
  const now = new Date("2026-11-06T18:00:00Z");
  assert.equal(quoteEarningsDate(event, "NIBE-B.ST", now).earningsInDays, 1);
  assert.equal(quoteEarningsDate(event, "MSFT", now).earningsInDays, 0);
});
test("DST weekends count calendar days, not elapsed 23/25 hour periods", () => {
  assert.equal(quoteEarningsDate(new Date("2026-03-29T10:00:00Z"), "BOL.ST",
    new Date("2026-03-28T22:30:00Z")).earningsInDays, 1);
  assert.equal(quoteEarningsDate(new Date("2026-11-01T18:00:00Z"), "MSFT",
    new Date("2026-11-01T03:30:00Z")).earningsInDays, 1);
});
test("past dates, seconds timestamps and invalid/unsupported inputs are explicit", () => {
  assert.equal(quoteEarningsDate(Date.parse("2026-11-05T18:00:00Z") / 1000, "AAPL",
    new Date("2026-11-06T18:00:00Z")).earningsInDays, -1);
  for (const ts of [null, undefined, NaN, new Date("invalid")]) {
    assert.deepEqual(quoteEarningsDate(ts, "AAPL"), { earningsDate: null, earningsInDays: null });
  }
  assert.equal(quoteEarningsDate(new Date(), "VOD.L").earningsInDays, null);
});
