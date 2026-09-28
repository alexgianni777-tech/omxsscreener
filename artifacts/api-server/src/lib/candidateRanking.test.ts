import assert from "node:assert/strict";
import test from "node:test";

import { candidateSelectionScore, selectSourceBalancedCandidates } from "./candidateRanking.ts";

const candidate = (ticker: string, signalSource: string, overrides: Record<string, unknown> = {}) => ({
  ticker,
  signalSource,
  direction: "LONG",
  category: "MOMENTUM",
  rank: 1,
  perf1m: signalSource === "edgeai" ? 0.55 : 12,
  rs3m: signalSource === "edgeai" ? 1 : 10,
  rsi: signalSource === "edgeai" ? 30 : 70,
  pctB: signalSource === "edgeai" ? 100 : 0,
  distFrom20dH: 0,
  ...overrides,
});

test("mixed sources are interleaved instead of compared in incompatible units", () => {
  const selected = selectSourceBalancedCandidates([
    candidate("EDGE-1", "edgeai"),
    candidate("EDGE-2", "edgeai", { rank: 2 }),
    candidate("TELEGRAM-1", "telegram"),
  ], 3);
  assert.deepEqual(selected.map((row) => row.ticker), ["EDGE-1", "TELEGRAM-1", "EDGE-2"]);
});

test("same-ticker candidates from different sources remain independently ranked", () => {
  const selected = selectSourceBalancedCandidates([
    candidate("SAME", "edgeai"),
    candidate("SAME", "telegram", { perf1m: 12, rs3m: 10 }),
  ], 2);
  assert.deepEqual(selected.map((row) => row.signalSource), ["edgeai", "telegram"]);
});

test("manual short weakness ranks in the correct direction", () => {
  const weak = candidate("WEAK", "telegram", { direction: "SHORT", perf1m: -12, rs3m: -8 });
  const strong = candidate("STRONG", "telegram", { direction: "SHORT", perf1m: 5, rs3m: 4 });
  assert.ok(candidateSelectionScore(weak) > candidateSelectionScore(strong));
});

test("EdgeAI score shrinks small samples and decays old signals", () => {
  const reliable = candidate("RELIABLE", "edgeai", { pctB: 200, distFrom20dH: 0 });
  const tinyOld = candidate("TINY-OLD", "edgeai", { pctB: 3, distFrom20dH: 9 });
  assert.ok(candidateSelectionScore(reliable) > candidateSelectionScore(tinyOld));
});