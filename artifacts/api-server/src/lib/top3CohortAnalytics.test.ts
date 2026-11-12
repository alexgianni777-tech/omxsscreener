import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTop3Cohorts, type Top3CohortSession } from "./top3CohortAnalytics.ts";

const pick = (outcome: string, r: number | null, direction = "LONG") => ({ outcome, r, direction });

test("keeps quick wins outside the mature cohort while losses remain pending", () => {
  const sessions: Top3CohortSession[] = [{
    selectionStatus: "AVAILABLE",
    picks: [
      pick("WIN", 1),
      pick("WIN", 1),
      pick("WIN", 1),
      pick("PENDING", null),
      pick("PENDING", null),
    ],
  }];

  const summary = summarizeTop3Cohorts(sessions);
  assert.equal(summary.selectedTrades, 5);
  assert.equal(summary.resolvedTrades, 3);
  assert.equal(summary.pendingTrades, 2);
  assert.equal(summary.resolutionRate, 3 / 5);
  assert.equal(summary.maturedSessions, 0);
  assert.equal(summary.matureCohort.totalTrades, 0);
  assert.equal(summary.matureCohort.winRate, null);
  assert.equal(summary.matureCohort.expectedValue, null);
  assert.equal(summary.resolvedOnly.winRate, 1);
  assert.equal(summary.resolvedOnly.expectedValue, 1);
});

test("moves a session into the mature cohort once every pick has recorded performance", () => {
  const sessions: Top3CohortSession[] = [{
    selectionStatus: "AVAILABLE",
    picks: [
      pick("WIN", 1),
      pick("WIN", 1),
      pick("WIN", 1),
      pick("LOSS", -1),
      pick("LOSS", -1),
    ],
  }];

  const summary = summarizeTop3Cohorts(sessions);
  assert.equal(summary.maturedSessions, 1);
  assert.equal(summary.pendingTrades, 0);
  assert.equal(summary.resolvedTrades, 5);
  assert.equal(summary.matureCohort.winRate, 3 / 5);
  assert.equal(summary.matureCohort.expectedValue, 0.2);
  assert.equal(summary.resolvedOnly.winRate, 3 / 5);
  assert.equal(summary.resolvedOnly.expectedValue, 0.2);
});

test("excludes SKIP from performance, does not mature zero-pick sessions, and handles empty cohorts", () => {
  const summary = summarizeTop3Cohorts([
    { selectionStatus: "AVAILABLE", picks: [pick("SKIP", null), pick("WIN", 0.5)] },
    { selectionStatus: "AVAILABLE", picks: [] },
    { selectionStatus: "UNAVAILABLE", picks: [] },
  ]);

  assert.equal(summary.selectedTrades, 2);
  assert.equal(summary.resolvedTrades, 1);
  assert.equal(summary.pendingTrades, 0);
  assert.equal(summary.excludedTrades, 1);
  assert.equal(summary.resolutionRate, 0.5);
  assert.equal(summary.maturedSessions, 1);
  assert.equal(summary.matureCohort.totalTrades, 1);
  assert.equal(summary.matureCohort.expectedValue, 0.5);
  assert.equal(summarizeTop3Cohorts([]).resolutionRate, null);
  assert.equal(summarizeTop3Cohorts([]).maturedSessions, 0);
});

test("does not mature or infer a TIME_EXIT without actual recorded performance", () => {
  const summary = summarizeTop3Cohorts([{
    selectionStatus: "AVAILABLE",
    picks: [pick("TIME_EXIT", null)],
  }]);
  assert.equal(summary.pendingTrades, 1);
  assert.equal(summary.maturedSessions, 0);
  assert.equal(summary.resolvedOnly.totalTrades, 0);
});