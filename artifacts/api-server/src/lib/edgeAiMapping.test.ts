import assert from "node:assert/strict";
import test from "node:test";

import { mapEdgeAiSetup } from "./edgeAiMapping.ts";

const validSetup = {
  ticker: "TEST",
  setup: "Momentum",
  dir: "long",
  entry: 100,
  stop: 95,
  target: 110,
  signalT: "2026-10-01T14:00:00Z",
  barsAgo: 0,
  rs: 0.25,
  edge: { winRate: 55, expectancyR: 0.2, sample: 100 },
};

test("EdgeAI R:R is calculated from entry, stop and target", () => {
  const candidate = mapEdgeAiSetup({
    ...validSetup,
    rr: 99,
    edge: { winRate: 55, expectancyR: 0.2, sample: 100 },
    chart: [],
  }, "SE", {});
  assert.equal(candidate.rr, 2);
  assert.equal(candidate.edgeWinRate, 0.55);
  assert.equal(candidate.edgeExpectancyR, 0.2);
  assert.equal(candidate.edgeSampleN, 100);
  assert.equal(candidate.signalAgeBars, 0);
  assert.equal(candidate.perf1m, 0);
  assert.equal(candidate.rsi, 0);
  assert.equal(candidate.pctB, 0);
  assert.equal(candidate.atr, 0);
  assert.equal(candidate.distFrom20dH, 0);
  assert.equal(candidate.maxHoldDays, 10);
});

test("EdgeAI signal age and statistics use dedicated fields", () => {
  const candidate = mapEdgeAiSetup({
    ...validSetup,
    barsAgo: 3,
    edge: { winRate: 55, expectancyR: 0.35, sample: 40 },
    chart: [],
  }, "US", {});

  assert.equal(candidate.edgeWinRate, 0.55);
  assert.equal(candidate.edgeExpectancyR, 0.35);
  assert.equal(candidate.edgeSampleN, 40);
  assert.equal(candidate.signalAgeBars, 3);
  assert.equal(candidate.perf1m, 0);
  assert.equal(candidate.rsi, 0);
  assert.equal(candidate.pctB, 0);
  assert.equal(candidate.distFrom20dH, 0);
});

test("EdgeAI candidates use the setup signalT market date, never the report date or server-local fallback", () => {
  const base = {
    ...validSetup,
    chart: [],
  };
  assert.equal(
    mapEdgeAiSetup({ ...base, signalT: "Mon Oct 26 2026 23:30:00 GMT-0400 (Eastern Daylight Time)" }, "US", {}).signalDate,
    "2026-10-26",
  );
  assert.equal(
    mapEdgeAiSetup({ ...base, signalT: "Tue Oct 27 2026 08:00:00 GMT+0000 (Coordinated Universal Time)" }, "SE", {}).signalDate,
    "2026-10-27",
  );
  assert.throws(() => mapEdgeAiSetup({ ...base, signalT: "2026-10-27T08:00:00" }, "SE", {}), /signalT/);
  assert.throws(() => mapEdgeAiSetup({ ...base, signalT: "not-a-date" }, "SE", {}), /signalT/);
});

test("signal indicators exclude bars after the trigger", () => {
  const chart = Array.from({ length: 31 }, (_, index) => ({
    o: index === 0 ? 100 : 99 + index,
    c: 100 + index,
  }));
  chart[30] = { o: 200, c: 200 };
  const candidate = mapEdgeAiSetup({
    ...validSetup,
    dir: "short",
    entry: 100,
    stop: 105,
    target: 90,
    barsAgo: 1,
    edge: { winRate: 55, expectancyR: 0.2, sample: 100 },
    chart,
  }, "SE", {});

  assert.equal(candidate.signalGapPct, 0);
});

test("missing direction or plan levels fail closed instead of becoming a LONG or zero", () => {
  const { dir: _dir, ...noDirection } = validSetup;
  assert.throws(() => mapEdgeAiSetup({ ...noDirection, edge: { winRate: 55, expectancyR: 1, sample: 12 } }, "SE", {}), /riktning/);
  const { entry: _entry, ...noEntry } = validSetup;
  assert.throws(() => mapEdgeAiSetup({ ...noEntry, edge: { winRate: 55, expectancyR: 1, sample: 12 } }, "SE", {}), /entry/);
});

test("EdgeAI SHORT plan direction and calibrated edge fields remain distinct", () => {
  const candidate = mapEdgeAiSetup({
    ...validSetup, dir: "short", stop: 105, target: 90,
    edge: { winRate: 56, expectancyR: 0.35, n: 40 },
  }, "US", {});
  assert.equal(candidate.direction, "SHORT");
  assert.equal(candidate.rr, 2);
  assert.equal(candidate.edgeSampleN, 40);
});