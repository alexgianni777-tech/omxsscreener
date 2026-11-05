import assert from "node:assert/strict";
import test from "node:test";
import { d1Freshness, marketDate, previousMarketDay, isTradingDay, signalSessionDate } from "@workspace/market-calendar";
import { decideCandidate } from "./screeningReview";

test("D−1 accepts weekday, Monday after Friday, exchange holidays and short sessions", () => {
  for (const [today, expected, market] of [
    ["2026-11-05", "2026-11-04", "SE"],
    ["2026-11-02", "2026-10-30", "SE"],
    ["2026-04-07", "2026-04-02", "SE"],
    ["2026-06-22", "2026-06-18", "SE"],
    ["2026-11-27", "2026-11-25", "US"],
    ["2026-12-28", "2026-12-23", "SE"],
    ["2026-12-28", "2026-12-24", "US"],
    ["2027-01-04", "2026-12-30", "SE"],
  ]) {
    assert.equal(previousMarketDay(today, market), expected);
    assert.equal(d1Freshness(expected, today, market).status, "CURRENT");
  }
});
test("closed days preserve next-session D−1, unknown and old dates never qualify", () => {
  assert.equal(d1Freshness("2026-11-06", "2026-11-08", "SE").status, "CURRENT");
  assert.equal(d1Freshness("2026-04-02", "2026-04-06", "SE").status, "CURRENT");
  for (const day of [null, "", "2026-02-30"]) {
    assert.equal(d1Freshness(day, "2026-11-05", "SE").status, "UNKNOWN");
  }
  assert.equal(d1Freshness("2026-11-03", "2026-11-05", "SE").status, "STALE");
  assert.equal(d1Freshness("2026-11-05", "2026-11-05", "SE").status, "CONFLICT");
  assert.equal(d1Freshness("2028-01-03", "2028-01-04", "SE").status, "UNKNOWN");
  assert.equal(d1Freshness("2026-11-04", "2026-11-05", "OTHER").status, "UNKNOWN");
  assert.equal(isTradingDay("2026-10-30", "SE"), true);
});
test("market dates respect DST and New York versus Stockholm midnight", () => {
  const now = new Date("2026-11-04T23:30:00Z");
  assert.equal(marketDate(now, "SE"), "2026-11-05");
  assert.equal(marketDate(now, "US"), "2026-11-04");
  assert.equal(marketDate(new Date("2026-03-29T22:15:00Z"), "SE"), "2026-03-30");
});
test("completed full and half sessions become next session's D−1, never today before close", () => {
  assert.equal(signalSessionDate(new Date("2026-11-06T16:29:00Z"), "SE"), "2026-11-06");
  assert.equal(signalSessionDate(new Date("2026-11-06T16:30:00Z"), "SE"), "2026-11-09");
  assert.equal(signalSessionDate(new Date("2026-10-30T12:00:00Z"), "SE"), "2026-11-02");
  assert.equal(signalSessionDate(new Date("2026-11-27T18:00:00Z"), "US"), "2026-11-30");
  assert.equal(signalSessionDate(new Date("2026-11-04T23:30:00Z"), "US"), "2026-11-05");
});
test("prior session is not itself a reason to mark a valid report stale; original plan unchanged", () => {
  const candidate = {
    market: "SE", category: "MOMENTUM", direction: "LONG", signalDate: "2026-04-02",
    signalSource: "edgeai", price: 100, volMultiplier: 1, volumeAsOf: "2026-04-02",
    rsi: 50, rr: 2, edgeExpectancyR: 0.2, entryPrice: 100, stopPrice: 95, targetPrice: 110,
    perf1m: 2, rs3m: 2, signalRsi: 50, signalGapPct: 0, earningsKnowledge: "UNKNOWN" as const,
    earningsInDays: null,
  };
  const before = structuredClone(candidate);
  assert.equal(decideCandidate(candidate, {status: "APPROVED", reasons: []},
    "2026-04-02", new Date("2026-04-07T08:00:00Z")).status, "TRADEABLE");
  assert.deepEqual(candidate, before);
});
