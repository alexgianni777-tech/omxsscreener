import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEarningsDailyReaction,
  buildPublicationReaction,
  isDailyHistoryStale,
  marketDayUtcBounds,
  marketDate,
  normalizeIntradayBars,
  type OhlcvBar,
} from "./earningsReportReaction";

function bars(): OhlcvBar[] {
  return [
    { date: "2026-10-20T00:00:00Z", open: 98, high: 101, low: 97, close: 100, volume: 1000 },
    { date: "2026-10-21T00:00:00Z", open: 100, high: 102, low: 99, close: 101, volume: 1100 },
    { date: "2026-10-22T00:00:00Z", open: 103, high: 110, low: 102, close: 108, volume: 1500 },
    { date: "2026-10-23T00:00:00Z", open: 108, high: 109, low: 104, close: 105, volume: 1200 },
    { date: "2026-10-26T00:00:00Z", open: 105, high: 111, low: 104, close: 110, volume: 1300 },
    { date: "2026-10-27T00:00:00Z", open: 110, high: 114, low: 109, close: 112, volume: 1400 },
    { date: "2026-10-28T00:00:00Z", open: 112, high: 113, low: 107, close: 109, volume: 1250 },
  ];
}

test("report day uses exact OHLCV and computes disclosed changes from prior close", () => {
  const result = buildEarningsDailyReaction(bars(), "2026-10-22", "SE");
  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(result.previousClose, { date: "2026-10-21", close: 101 });
  assert.deepEqual(result.reportDay, {
    date: "2026-10-22", open: 103, high: 110, low: 102, close: 108, volume: 1500,
  });
  assert.deepEqual(result.changePct, { open: 1.9802, high: 8.9109, low: 0.9901, close: 6.9307 });
  assert.deepEqual(result.postReport.map((move) => [move.sessions, move.date, move.returnPct]), [
    [1, "2026-10-23", -2.7778],
    [3, "2026-10-27", 3.7037],
    [5, null, null],
  ]);
  assert.equal(result.dataAsOf, "2026-10-28");
});

test("missing exact report-day data is explicit and does not borrow a neighboring bar", () => {
  const result = buildEarningsDailyReaction(bars(), "2026-10-24", "SE");
  assert.equal(result.status, "MISSING");
  assert.equal(result.reportDay, null);
  assert.equal(result.previousClose, null);
  assert.match(result.reason ?? "", /exakt dagsstapel/);
});

test("invalid OHLC geometry and conflicting duplicate dates are CONFLICT, not numbers", () => {
  const invalid = [...bars()];
  invalid[2] = { ...invalid[2], low: 107 };
  const malformed = buildEarningsDailyReaction(invalid, "2026-10-22", "SE");
  assert.equal(malformed.status, "CONFLICT");
  assert.equal(malformed.reportDay, null);
  assert.equal(malformed.changePct, null);

  const duplicate = [...bars(), { ...bars()[2], close: 109 }];
  const duplicated = buildEarningsDailyReaction(duplicate, "2026-10-22", "SE");
  assert.equal(duplicated.status, "CONFLICT");
  assert.equal(duplicated.reportDay, null);

  const irrelevantDuplicate = [
    ...bars(),
    { ...bars()[0], close: 99 },
  ];
  assert.equal(buildEarningsDailyReaction(irrelevantDuplicate, "2026-10-22", "SE").status, "AVAILABLE");
});

test("minute data is timestamped, market-date filtered and conflicts fail closed", () => {
  const data = normalizeIntradayBars([
    { date: "2026-10-22T07:00:00Z", open: 100, high: 101, low: 99, close: 100.5, volume: 20 },
    { date: "2026-10-22T07:01:00Z", open: 100.5, high: 102, low: 100, close: 101.5, volume: 30 },
    { date: "2026-10-23T07:00:00Z", open: 101.5, high: 102, low: 101, close: 101.8, volume: 10 },
  ], "2026-10-22", "SE");
  assert.equal(data.status, "AVAILABLE");
  assert.equal(data.candles.length, 2);
  assert.equal(data.asOf, "2026-10-22T07:01:00.000Z");

  const missing = normalizeIntradayBars([], "2026-10-22", "SE");
  assert.equal(missing.status, "MISSING");
  assert.equal(missing.candles.length, 0);

  const conflict = normalizeIntradayBars([
    { date: "2026-10-22T07:00:00Z", open: 100, high: 101, low: 99, close: 100, volume: 5 },
    { date: "2026-10-22T07:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 5 },
  ], "2026-10-22", "SE");
  assert.equal(conflict.status, "CONFLICT");
  assert.equal(conflict.candles.length, 0);
});

test("market date follows exchange timezone and stale compares only actual source dates", () => {
  assert.equal(marketDate("2026-10-29T02:00:00Z", "US"), "2026-10-28");
  assert.equal(marketDate("2026-10-28T23:30:00Z", "SE"), "2026-10-29");
  assert.equal(isDailyHistoryStale("2026-10-26", "2026-10-28T20:00:00Z", "US", new Date("2026-10-28T22:00:00Z")), true);
  assert.equal(isDailyHistoryStale("2026-10-28", "2026-10-28T20:00:00Z", "US", new Date("2026-10-28T22:00:00Z")), false);
  assert.equal(isDailyHistoryStale("2026-10-28", null, "US"), null);
});

test("equally old Yahoo series cannot approve freshness; D-1 during trading and weekends are valid", () => {
  assert.equal(isDailyHistoryStale("2026-10-30", "2026-10-30T20:00:00Z", "US", new Date("2026-11-04T18:00:00Z")), true);
  assert.equal(isDailyHistoryStale("2026-11-03", "2026-11-04T15:00:00Z", "US", new Date("2026-11-04T15:00:00Z")), false);
  assert.equal(isDailyHistoryStale("2026-10-30", "2026-10-30T20:00:00Z", "US", new Date("2026-11-01T15:00:00Z")), false);
  assert.equal(isDailyHistoryStale("2026-10-30", "2026-10-30T20:00:00Z", "US", new Date("2026-11-03T15:00:00Z")), null);
});

test("actual publication before opening vs after closing controls reaction day, never quarter-end", () => {
  const now = new Date("2026-11-04T18:00:00Z");
  const before = buildPublicationReaction(bars(), "2026-10-22T05:00:00Z", "SE", now);
  assert.equal(before.releaseSession, "PRE_MARKET");
  assert.equal(before.reportDay?.date, "2026-10-22");
  const after = buildPublicationReaction(bars(), "2026-10-22T18:00:00Z", "SE", now);
  assert.equal(after.releaseSession, "AFTER_CLOSE");
  assert.equal(after.reportDate, "2026-10-22");
  assert.equal(after.reportDay?.date, "2026-10-23");
  assert.equal(after.previousClose?.close, 108);
  for (const timestamp of ["2026-09-30", "2026-09-30T00:00:00Z", null]) {
    const missing = buildPublicationReaction(bars(), timestamp, "SE", now);
    assert.equal(missing.status, "MISSING");
    assert.equal(missing.changePct, null);
  }
  assert.equal(buildPublicationReaction(bars(), "2026-10-22T10:00:00Z", "SE", now).status, "MISSING");
  assert.equal(buildPublicationReaction(bars(), "2026-11-05T18:00:00Z", "SE", now).status, "UPCOMING");
});

test("intraday request bounds cover the full exchange-local day including after-hours", () => {
  const us = marketDayUtcBounds("2026-10-29", "US");
  assert.equal(us?.start.toISOString(), "2026-10-29T04:00:00.000Z");
  assert.equal(us?.end.toISOString(), "2026-10-30T04:00:00.000Z");
  const sweden = marketDayUtcBounds("2026-10-29", "SE");
  assert.equal(sweden?.start.toISOString(), "2026-10-28T23:00:00.000Z");
  assert.equal(sweden?.end.toISOString(), "2026-10-29T23:00:00.000Z");
  assert.equal(marketDayUtcBounds("2026-02-30", "SE"), null);
});
