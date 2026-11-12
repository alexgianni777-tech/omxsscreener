import assert from "node:assert/strict";
import test from "node:test";
import { edgeAiMetrics, edgeAiScore } from "./edgeAiMetrics";

test("EdgeAI metrics use dedicated candidate fields, never neutral legacy values", () => {
  const metrics = edgeAiMetrics({
    signalSource: "edgeai",
    edgeWinRate: 0.64,
    edgeExpectancyR: 0.42,
    edgeSampleN: 80,
    signalAgeBars: 3,
    maxHoldDays: 10,
    // Neutral legacy fields must not be used as EdgeAI fallbacks.
    rsi: 50,
    perf1m: 0,
    pctB: 0,
    distFrom20dH: 0,
  });

  assert.deepEqual(metrics, {
    isEdgeAI: true,
    winRate: 0.64,
    expectancyR: 0.42,
    sampleN: 80,
    signalAgeBars: 3,
    maxHoldDays: 10,
  });
  assert.equal(edgeAiScore({
    signalSource: "edgeai",
    edgeExpectancyR: 0.42,
    edgeSampleN: 80,
    signalAgeBars: 3,
    maxHoldDays: 10,
  }), 0.42 * (80 / 100) * 0.7);
});

test("missing EdgeAI fields stay unknown despite populated legacy values", () => {
  const metrics = edgeAiMetrics({
    signalSource: "edgeai",
    rsi: 50,
    perf1m: 0.5,
    pctB: 40,
    distFrom20dH: 2,
  });

  assert.deepEqual(metrics, {
    isEdgeAI: true,
    winRate: null,
    expectancyR: null,
    sampleN: null,
    signalAgeBars: null,
    maxHoldDays: null,
  });
  assert.equal(edgeAiScore({
    signalSource: "edgeai",
    rsi: 50,
    pctB: 40,
    distFrom20dH: 2,
  }), null);
  assert.equal(edgeAiMetrics({ signalSource: "telegram", edgeWinRate: 0.9 }).isEdgeAI, false);
});