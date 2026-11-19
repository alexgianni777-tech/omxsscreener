import assert from "node:assert/strict";
import test from "node:test";
import type { JournalRecord } from "@workspace/api-client-react";
import { performanceLabMetrics } from "./performanceLabMetrics";

function execution(id: string, mode: "REAL" | "SIMULATED" | "NOT_TAKEN", exitPrice: number | null): JournalRecord {
  const executed = mode !== "NOT_TAKEN";
  const netR = exitPrice == null ? null : exitPrice > 10 ? 2 : -1;
  return {
    id,
    createdAt: "2026-11-19T13:00:00.000Z",
    input: {
      id: `${id}-record-000000000000000000000000000`,
      candidateId: 1,
      mode,
      instrumentKind: executed ? "SHARE" : null,
      side: executed ? "LONG" : null,
      entryTime: executed ? "2026-11-19T10:00:00.000Z" : null,
      exitTime: executed ? "2026-11-19T12:00:00.000Z" : null,
      fillPrice: executed ? 10 : null,
      stopPrice: executed ? 9 : null,
      targetPrice: executed ? 12 : null,
      exitPrice,
      quantity: executed ? 1 : null,
      priceCurrency: executed ? "SEK" : null,
      entryFxSek: executed ? 1 : null,
      exitFxSek: executed ? 1 : null,
      leverage: null,
      spreadCostKr: null,
      slippageCostKr: null,
      financingCostKr: executed ? 0 : null,
      commissionKr: executed ? 0 : null,
      notes: mode === "NOT_TAKEN" ? "Avstod" : "Testfixtur",
    },
    signal: {
      ticker: "TEST",
      source: "manual",
      signalDate: "2026-11-19",
      dataDate: "2026-11-18",
      bucket: "MOMENTUM",
      direction: "LONG",
      sessionId: 1,
      entryPrice: 10,
      stopPrice: 9,
      targetPrice: 12,
      rr: 2,
    },
    metrics: {
      grossR: netR,
      netR,
      riskCashKr: executed ? 1 : null,
      netPnlKr: netR == null ? null : netR,
    },
  };
}

test("Performance Lab counts only verified REAL executions", () => {
  const metrics = performanceLabMetrics([
    execution("real-win", "REAL", 12),
    execution("real-loss", "REAL", 9),
    execution("paper-win", "SIMULATED", 12),
    execution("not-taken", "NOT_TAKEN", null),
  ], Date.parse("2026-11-20T00:00:00.000Z"));

  assert.equal(metrics.verifiedRealCount, 2);
  assert.equal(metrics.targetRealCount, 50);
  assert.equal(metrics.simulatedCount, 1);
  assert.equal(metrics.notTakenCount, 1);
  assert.equal(metrics.netExpectancyR, 0.5);
  assert.deepEqual(metrics.winRate95Ci && metrics.winRate95Ci.length, 2);
  assert.ok(metrics.expectancy95Ci);
  assert.equal(metrics.evidenceStatus, "INSUFFICIENT_DATA");
});

test("empty data and incomplete costs never become zero-performance claims", () => {
  const empty = performanceLabMetrics([]);
  assert.equal(empty.verifiedRealCount, 0);
  assert.equal(empty.netExpectancyR, null);
  assert.equal(empty.winRate, null);
  assert.equal(empty.winRate95Ci, null);
  assert.equal(empty.evidenceStatus, "NOT_VERIFIED");

  const incomplete = execution("incomplete", "REAL", 12);
  incomplete.input.commissionKr = null;
  const metrics = performanceLabMetrics([incomplete], Date.parse("2026-11-20T00:00:00.000Z"));
  assert.equal(metrics.verifiedRealCount, 0);
  assert.equal(metrics.netExpectancyR, null);
  assert.equal(metrics.evidenceStatus, "NOT_VERIFIED");
});

test("single verified execution has no misleading expectancy confidence interval", () => {
  const metrics = performanceLabMetrics(
    [execution("real-win", "REAL", 12)],
    Date.parse("2026-11-20T00:00:00.000Z"),
  );
  assert.equal(metrics.verifiedRealCount, 1);
  assert.equal(metrics.expectancy95Ci, null);
  assert.equal(metrics.evidenceStatus, "INSUFFICIENT_DATA");
});
