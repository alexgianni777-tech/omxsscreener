import assert from "node:assert/strict";
import test from "node:test";
import { isAcceptedSignalDate, previousTradingDate, stockholmSignalDate } from "./signalDatePolicy";
import { decideCandidate, reviewCandidate } from "./screeningReview";
import { buildTop3LiveSelection } from "./top3LiveSelection";
import { buildTop3SelectionSnapshot } from "./top3SelectionPolicyCore";
import { candidateIdentity } from "./candidateSynchronizationPolicy";

const today = "2026-10-02";
const now = new Date("2026-10-02T10:00:00Z");
function candidate(id: number, source: "telegram" | "edgeai", date = "2026-10-01") {
  return {
    id, ticker: `SIGNAL${id}`, category: "MOMENTUM", market: "SE", direction: "LONG",
    rank: id, signalDate: date, signalSource: source, createdAt: now,
    price: 100, perf1m: 3, rs3m: 2, rsi: 50, pctB: 0.5, distFrom20dH: 1,
    edgeExpectancyR: 0.2, edgeSampleN: 100, signalAgeBars: 0, maxHoldDays: 10,
    signalRsi: 50, signalGapPct: 0, volMultiplier: 1, volumeAsOf: "2026-09-30",
    earningsInDays: 30, earningsKnowledge: "SIGNAL_TIME",
    entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2,
  } as any;
}

test("accepts today and one previous close, rejecting older, unknown, invalid and future dates", () => {
  assert.equal(isAcceptedSignalDate(today, today), true);
  assert.equal(isAcceptedSignalDate("2026-10-01", today), true);
  for (const date of ["2026-09-30", "2026-10-03", null, "", "2026-02-30"]) {
    assert.equal(isAcceptedSignalDate(date, today), false);
  }
});

test("weekends use the previous weekday close, with no multi-trading-day grace", () => {
  assert.equal(previousTradingDate("2026-10-05"), "2026-10-02");
  assert.equal(isAcceptedSignalDate("2026-10-02", "2026-10-05"), true);
  assert.equal(isAcceptedSignalDate("2026-10-01", "2026-10-05"), false);
});

test("signal-day boundaries use Stockholm, not UTC", () => {
  assert.equal(stockholmSignalDate(new Date("2026-10-01T22:15:00Z")), "2026-10-02");
});

test("previous-close reports are received and can qualify for Top 3 without changing their source dates", () => {
  const candidates = [candidate(1, "telegram"), candidate(2, "edgeai")];
  const live = buildTop3LiveSelection({
    id: 123, date: today, source: "mixed", top3SnapshotAt: null, top3CutoffEvaluatedAt: null,
  }, candidates, now)!;
  assert.equal(live.sourceReceipts.telegram.received, true);
  assert.equal(live.sourceReceipts.edgeai.received, true);
  assert.deepEqual(live.sourceReceipts.telegram.signalDates, ["2026-10-01"]);
  assert.equal(live.picks.length, 2);
  const selections = buildTop3SelectionSnapshot(candidates, 123, today, "mixed", now);
  assert.equal(selections.filter((row) => row.selected).length, 2);
  assert.ok(candidates.every((row) => row.signalDate === "2026-10-01"));
});

test("the lag exception does not bypass invalid volume, earnings, negative LONG edge or signal max-age", () => {
  const original = candidate(1, "edgeai");
  for (const override of [
    { volMultiplier: 0 }, { earningsInDays: 1 }, { edgeExpectancyR: -0.2 }, { signalAgeBars: 10 },
  ]) {
    const input = { ...original, ...override };
    const decision = decideCandidate(input, reviewCandidate(input, "edgeai"), today, now);
    assert.notEqual(decision.status, "TRADEABLE");
  }
});

test("a new source-date signal has a different identity, so it cannot rewrite the original trade", () => {
  const original = candidate(1, "edgeai");
  const fresh = { ...original, signalDate: today };
  assert.notEqual(candidateIdentity(original), candidateIdentity(fresh));
  assert.equal(original.signalDate, "2026-10-01");
});