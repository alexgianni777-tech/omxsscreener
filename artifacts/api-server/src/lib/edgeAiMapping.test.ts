import assert from "node:assert/strict";
import test from "node:test";

import { mapEdgeAiSetup } from "./edgeAiMapping.ts";

test("EdgeAI R:R is calculated from entry, stop and target", () => {
  const candidate = mapEdgeAiSetup({
    ticker: "TEST",
    dir: "long",
    entry: 100,
    stop: 95,
    target: 110,
    rr: 99,
    edge: { winRate: 55, expectancyR: 0.2, sample: 100 },
    chart: [],
  }, "SE", {});
  assert.equal(candidate.rr, 2);
  assert.equal(candidate.edgeWinRate, 0.55);
  assert.equal(candidate.edgeExpectancyR, 0.2);
  assert.equal(candidate.edgeSampleN, 100);
  assert.equal(candidate.signalAgeBars, 0);
  assert.equal(candidate.maxHoldDays, 10);
});

test("signal indicators exclude bars after the trigger", () => {
  const chart = Array.from({ length: 31 }, (_, index) => ({
    o: index === 0 ? 100 : 99 + index,
    c: 100 + index,
  }));
  chart[30] = { o: 200, c: 200 };
  const candidate = mapEdgeAiSetup({
    ticker: "TEST",
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