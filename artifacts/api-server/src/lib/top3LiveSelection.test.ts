import assert from "node:assert/strict";
import test from "node:test";
import { buildTop3LiveSelection } from "./top3LiveSelection.ts";
import { top3CutoffForDate } from "./top3SelectionPolicyCore.ts";

const sessionDate = "2026-09-30";
const beforeCutoff = new Date("2026-09-30T10:00:00.000Z");

function candidate(
  id: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    ticker: `TICK${id}`,
    category: "MOMENTUM",
    rank: id,
    market: "SE",
    direction: "LONG",
    signalSource: "telegram",
    signalDate: sessionDate,
    createdAt: new Date("2026-09-30T09:30:00.000Z"),
    price: 100,
    perf1m: 4,
    rs3m: 3,
    rsi: 50,
    pctB: 0.5,
    distFrom20dH: 1,
    edgeExpectancyR: null,
    edgeSampleN: null,
    signalAgeBars: null,
    maxHoldDays: 10,
    signalRsi: null,
    signalGapPct: null,
    volMultiplier: 1,
    volumeAsOf: "2026-09-29",
    earningsInDays: 30,
    earningsKnowledge: "SIGNAL_TIME",
    entryPrice: 100,
    stopPrice: 95,
    targetPrice: 106,
    rr: 1.2,
    ...overrides,
  } as any;
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    date: sessionDate,
    source: "mixed",
    top3SnapshotAt: null,
    top3CutoffEvaluatedAt: null,
    ...overrides,
  };
}

test("one exact-source receipt can produce a read-only preliminary pick", () => {
  const result = buildTop3LiveSelection(session(), [candidate(1)], beforeCutoff)!;

  assert.equal(result.previewAvailable, true);
  assert.deepEqual(result.sourceReceipts.telegram, {
    received: true,
    candidateCount: 1,
    receivedBeforeCutoff: true,
  });
  assert.deepEqual(result.sourceReceipts.edgeai, {
    received: false,
    candidateCount: 0,
    receivedBeforeCutoff: false,
  });
  assert.equal(result.picks.length, 1);
  assert.deepEqual(result.picks[0], {
    candidateId: 1,
    rank: 1,
    score: result.picks[0].score,
    market: "SE",
    direction: "LONG",
    signalSource: "telegram",
  });
  assert.equal(Number.isFinite(result.picks[0].score), true);
});

test("both required-source receipts are reported independently and both may contribute picks", () => {
  const result = buildTop3LiveSelection(session(), [
    candidate(1),
    candidate(2, { signalSource: "edgeai", market: "US" }),
  ], beforeCutoff)!;

  assert.equal(result.previewAvailable, true);
  assert.equal(result.sourceReceipts.telegram.candidateCount, 1);
  assert.equal(result.sourceReceipts.edgeai.candidateCount, 1);
  assert.deepEqual(result.picks.map(({ signalSource }) => signalSource), ["telegram", "edgeai"]);
});

test("missing source does not block preliminary status but is never represented as received", () => {
  const result = buildTop3LiveSelection(session(), [candidate(1)], beforeCutoff)!;

  assert.equal(result.previewAvailable, true);
  assert.equal(result.sourceReceipts.edgeai.received, false);
  assert.equal(result.sourceReceipts.edgeai.candidateCount, 0);
});

test("manual and stale signal rows do not count as today's Telegram or EdgeAI receipts", () => {
  const result = buildTop3LiveSelection(session(), [
    candidate(1, { signalSource: "manual" }),
    candidate(2, { signalSource: "telegram", signalDate: "2026-09-29" }),
    candidate(3, {
      signalSource: "edgeai",
      createdAt: new Date(beforeCutoff.getTime() + 1),
    }),
  ], beforeCutoff)!;

  assert.equal(result.previewAvailable, false);
  assert.equal(result.sourceReceipts.telegram.candidateCount, 0);
  assert.equal(result.sourceReceipts.edgeai.candidateCount, 0);
  assert.deepEqual(result.picks, []);
});

test("a received source with zero tradeable picks remains available without inventing a selection", () => {
  const result = buildTop3LiveSelection(
    session(),
    [candidate(1, { volumeAsOf: null })],
    beforeCutoff,
  )!;

  assert.equal(result.previewAvailable, true);
  assert.equal(result.sourceReceipts.telegram.received, true);
  assert.deepEqual(result.picks, []);
});

test("strict cutoff boundary reports arrivals but does not offer a preliminary preview at cutoff", () => {
  const cutoff = top3CutoffForDate(sessionDate);
  const before = buildTop3LiveSelection(
    session(),
    [candidate(1, { createdAt: new Date(cutoff.getTime() - 1) })],
    new Date(cutoff.getTime() - 1),
  )!;
  const atCutoff = buildTop3LiveSelection(
    session(),
    [candidate(2, { createdAt: cutoff })],
    cutoff,
  )!;

  assert.equal(before.previewAvailable, true);
  assert.equal(before.sourceReceipts.telegram.receivedBeforeCutoff, true);
  assert.equal(atCutoff.previewAvailable, false);
  assert.equal(atCutoff.sourceReceipts.telegram.received, true);
  assert.equal(atCutoff.sourceReceipts.telegram.receivedBeforeCutoff, false);
  assert.deepEqual(atCutoff.picks, []);
});

test("same-day live status remains visible after an official seal but preview picks are suppressed", () => {
  const candidateRows = [candidate(1)];
  for (const seal of [
    { top3SnapshotAt: new Date("2026-09-30T14:30:00.000Z") },
    { top3CutoffEvaluatedAt: new Date("2026-09-30T14:30:00.000Z") },
  ]) {
    const result = buildTop3LiveSelection(session(seal), candidateRows, beforeCutoff)!;
    assert.equal(result.previewAvailable, false);
    assert.equal(result.sourceReceipts.telegram.received, true);
    assert.deepEqual(result.picks, []);
  }
});

test("historical sessions never receive live source status or preliminary picks", () => {
  assert.equal(
    buildTop3LiveSelection(session({ date: "2026-09-29" }), [candidate(1)], beforeCutoff),
    undefined,
  );
});