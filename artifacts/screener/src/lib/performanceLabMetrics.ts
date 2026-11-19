import type { JournalRecord } from "@workspace/api-client-react";
import { journalAnalysis } from "./journalAnalysis";

export type PerformanceLabMetrics = {
  verifiedRealCount: number;
  targetRealCount: 50;
  simulatedCount: number;
  notTakenCount: number;
  excludedRealCount: number;
  netExpectancyR: number | null;
  expectancy95Ci: [number, number] | null;
  winRate: number | null;
  winRate95Ci: [number, number] | null;
  profitFactor: number | null;
  profitFactorStatus: string;
  maxDrawdownR: number | null;
  drawdownStatus: string;
  evidenceStatus: string;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function wilsonInterval(successes: number, total: number): [number, number] | null {
  if (total < 1) return null;
  const z = 1.96;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/**
 * Descriptive metrics from journalAnalysis's verified REAL executions only.
 * This deliberately excludes signal outcomes, SIMULATED and NOT_TAKEN rows.
 */
export function performanceLabMetrics(records: readonly JournalRecord[], now = Date.now()): PerformanceLabMetrics {
  const analysis = journalAnalysis(records, now);
  const verified = analysis.rows.filter((row) =>
    row.record.input.mode === "REAL" && row.executed && finite(row.netR),
  );
  const values = verified.map((row) => row.netR as number);
  const n = values.length;
  const netExpectancyR = n ? values.reduce((sum, value) => sum + value, 0) / n : null;

  let expectancy95Ci: [number, number] | null = null;
  if (n >= 2 && netExpectancyR != null) {
    const sumSquares = values.reduce((sum, value) => sum + (value - netExpectancyR) ** 2, 0);
    const standardError = Math.sqrt(sumSquares / (n - 1)) / Math.sqrt(n);
    if (finite(standardError)) {
      // Normal approximation; small samples remain explicitly insufficient.
      expectancy95Ci = [
        netExpectancyR - 1.96 * standardError,
        netExpectancyR + 1.96 * standardError,
      ];
    }
  }

  const wins = values.filter((value) => value > 0).length;
  const winRate = n ? wins / n : null;
  const stats = analysis.net;
  return {
    verifiedRealCount: n,
    targetRealCount: 50,
    simulatedCount: analysis.simulated,
    notTakenCount: analysis.notTaken,
    excludedRealCount: analysis.excluded,
    netExpectancyR: finite(netExpectancyR) ? netExpectancyR : null,
    expectancy95Ci,
    winRate,
    winRate95Ci: wilsonInterval(wins, n),
    profitFactor: stats.profitFactor,
    profitFactorStatus: stats.profitFactorStatus,
    maxDrawdownR: stats.maxDrawdownR,
    drawdownStatus: stats.drawdownStatus,
    evidenceStatus: n === 0 ? "NOT_VERIFIED" : n < 20 ? "INSUFFICIENT_DATA" : "DESCRIPTIVE_ONLY",
  };
}
