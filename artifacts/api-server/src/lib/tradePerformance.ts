export type PerformanceResult = "WIN" | "LOSS" | "FLAT";

export interface TradePerformanceInput {
  outcome: string | null;
  realizedR: number | null;
  exitPrice: number | null;
  entryPrice: number | null;
  stopPrice: number | null;
  direction: string | null;
  resolutionEntryPrice: number | null;
  resolutionStopPrice: number | null;
  resolutionDirection: string | null;
}

export interface TradePerformance {
  r: number;
  result: PerformanceResult;
}

/**
 * Resolve the authoritative realized R and classify it by signed outcome.
 * Persisted R is sufficient by itself; legacy rows require an exit and a
 * usable risk unit. WIN/LOSS labels whose R sign disagrees are not performance.
 */
export function resolveTradePerformance(
  trade: TradePerformanceInput,
): TradePerformance | null {
  let r: number | null = null;

  if (trade.realizedR != null) {
    if (!Number.isFinite(trade.realizedR)) return null;
    r = trade.realizedR;
  } else if (
    trade.exitPrice != null &&
    Number.isFinite(trade.exitPrice)
  ) {
    const entry = trade.resolutionEntryPrice ?? trade.entryPrice;
    const stop = trade.resolutionStopPrice ?? trade.stopPrice;
    const direction = trade.resolutionDirection ?? trade.direction;
    if (
      entry != null &&
      stop != null &&
      Number.isFinite(entry) &&
      Number.isFinite(stop) &&
      entry !== stop &&
      (direction === "LONG" || direction === "SHORT")
    ) {
      const oneR = Math.abs(entry - stop);
      r = direction === "LONG"
        ? (trade.exitPrice - entry) / oneR
        : (entry - trade.exitPrice) / oneR;
    }
  }

  if (r == null || !Number.isFinite(r)) return null;
  if (trade.outcome === "WIN") return r > 0 ? { r, result: "WIN" } : null;
  if (trade.outcome === "LOSS") return r < 0 ? { r, result: "LOSS" } : null;
  if (trade.outcome === "TIME_EXIT") {
    return { r, result: r > 0 ? "WIN" : r < 0 ? "LOSS" : "FLAT" };
  }
  return null;
}