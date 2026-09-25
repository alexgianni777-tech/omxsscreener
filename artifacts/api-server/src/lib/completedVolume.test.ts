import assert from "node:assert/strict";
import test from "node:test";

import { fetchCompletedVolumeMultiplier } from "./completedVolume.ts";

type Bar = {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function day(date: string, volume: number): Bar {
  return {
    date: new Date(`${date}T00:00:00.000Z`),
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume,
  };
}

function priorTradingDays(asOfDate: string, volumes = Array.from({ length: 10 }, (_, index) => (index + 1) * 100)): Bar[] {
  const bars: Bar[] = [];
  const date = new Date(`${asOfDate}T00:00:00.000Z`);
  let daysBack = 1;
  while (bars.length < volumes.length) {
    const candidate = new Date(date.getTime() - daysBack * 86_400_000);
    daysBack++;
    if (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) continue;
    bars.unshift(day(candidate.toISOString().slice(0, 10), volumes[bars.length]));
  }
  return bars;
}

function fakeYahoo(history: unknown) {
  const calls: { ticker: string; options: { period1: Date; period2: Date; interval: "1d" } }[] = [];
  return {
    calls,
    yf: {
      historical: async (
        ticker: string,
        options: { period1: Date; period2: Date; interval: "1d" },
      ) => {
        calls.push({ ticker, options });
        return history;
      },
    },
  };
}

test("matches the exact daily bar and compares its volume with the prior ten positive bars", async () => {
  const asOfDate = "2024-03-20";
  const bars = priorTradingDays(asOfDate);
  bars.push(day(asOfDate, 550));
  bars.push(day("2024-03-21", 99_999));
  const { yf, calls } = fakeYahoo(bars);

  const result = await fetchCompletedVolumeMultiplier(yf, "ABC.ST", asOfDate, "SE");

  assert.deepEqual(result, { multiplier: 1, asOf: asOfDate });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ticker, "ABC.ST");
  assert.equal(calls[0].options.interval, "1d");
});

test("returns null if the exact as-of date is missing", async () => {
  const { yf } = fakeYahoo(priorTradingDays("2024-03-20"));
  assert.equal(await fetchCompletedVolumeMultiplier(yf, "ABC", "2024-03-20", "US"), null);
});

test("returns null when target OHLCV fields are missing, non-finite, or non-positive", async () => {
  for (const [field, value] of [
    ["open", undefined],
    ["high", Number.NaN],
    ["low", 0],
    ["close", -1],
    ["volume", Number.POSITIVE_INFINITY],
  ] as const) {
    const asOfDate = "2024-03-20";
    const target = { ...day(asOfDate, 500), [field]: value };
    const { yf } = fakeYahoo([...priorTradingDays(asOfDate), target]);
    assert.equal(await fetchCompletedVolumeMultiplier(yf, "ABC", asOfDate, "US"), null, `${field} should be rejected`);
  }
});

test("requires ten prior positive-volume bars and excludes the as-of bar from the average", async () => {
  const asOfDate = "2024-03-20";
  const insufficient = [...priorTradingDays(asOfDate, Array(9).fill(100)), day(asOfDate, 1_000)];
  const insufficientClient = fakeYahoo(insufficient);
  assert.equal(await fetchCompletedVolumeMultiplier(insufficientClient.yf, "ABC", asOfDate, "US"), null);

  const bars = [...priorTradingDays(asOfDate, Array(12).fill(100)), day(asOfDate, 300)];
  bars[1].volume = 0;
  bars[2].volume = -5;
  const { yf } = fakeYahoo(bars);
  assert.deepEqual(await fetchCompletedVolumeMultiplier(yf, "ABC", asOfDate, "US"), {
    multiplier: 3,
    asOf: asOfDate,
  });
});

test("does not count an incomplete prior daily bar in the ten-day baseline", async () => {
  const asOfDate = "2024-03-20";
  const bars = [...priorTradingDays(asOfDate), day(asOfDate, 300)];
  delete (bars[0] as Partial<Bar>).close;
  const { yf } = fakeYahoo(bars);
  assert.equal(await fetchCompletedVolumeMultiplier(yf, "ABC", asOfDate, "US"), null);
});

test("retains a positive ratio that would otherwise round to zero", async () => {
  const asOfDate = "2024-03-20";
  const bars = [...priorTradingDays(asOfDate, Array(10).fill(1_000_000)), day(asOfDate, 1)];
  const { yf } = fakeYahoo(bars);
  assert.deepEqual(await fetchCompletedVolumeMultiplier(yf, "ABC", asOfDate, "US"), {
    multiplier: 0.000001,
    asOf: asOfDate,
  });
});

test("rejects malformed dates and only applies the close buffer to the exchange's current date", async () => {
  const { yf, calls } = fakeYahoo([...priorTradingDays("2024-03-20"), day("2024-03-20", 500)]);
  assert.equal(await fetchCompletedVolumeMultiplier(yf, "ABC", "2024-02-30", "US"), null);
  assert.equal(calls.length, 0);

  const result = await fetchCompletedVolumeMultiplier(yf, "ABC", "2024-03-20", "US");
  assert.deepEqual(result, { multiplier: 0.91, asOf: "2024-03-20" });
  assert.equal(calls.length, 1);
});

test("does not request today's bar until 90 minutes after the relevant exchange close", async () => {
  for (const { market, timeZone, cutoff } of [
    { market: "SE" as const, timeZone: "Europe/Stockholm", cutoff: 19 * 60 },
    { market: "US" as const, timeZone: "America/New_York", cutoff: 17 * 60 + 30 },
  ]) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    const asOfDate = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
    const minuteOfDay = Number(getPart("hour")) * 60 + Number(getPart("minute"));
    const { yf, calls } = fakeYahoo([...priorTradingDays(asOfDate), day(asOfDate, 550)]);

    const result = await fetchCompletedVolumeMultiplier(yf, "ABC", asOfDate, market);

    if (minuteOfDay < cutoff) {
      assert.equal(result, null);
      assert.equal(calls.length, 0);
    } else {
      assert.deepEqual(result, { multiplier: 1, asOf: asOfDate });
      assert.equal(calls.length, 1);
    }
  }
});