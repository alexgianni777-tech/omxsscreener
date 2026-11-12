/**
 * Single source of truth for mapping a raw EdgeAI setup object to a candidate
 * row's fields. Used by BOTH the scheduled auto-import (scheduler.ts) and the
 * manual "Importera från EdgeAI" endpoint (routes/edgeai.ts).
 *
 * IMPORTANT: never re-implement this mapping in either caller. A rounding/type
 * mismatch between two separate copies of this logic has already caused a real
 * incident: one copy rounded `rsi` before insert (the column is an integer)
 * while the other didn't, so the daily auto-import silently rolled back its
 * transaction whenever a fractional value appeared — invisible until someone
 * checked whether a session existed for that date. Keep this the only copy.
 */
import { calculateOpeningGapPct, calculateWilderRsi } from "./marketIndicators.ts";
import { edgeAiDirection, edgeAiSampleN, edgeAiSignalDate, validateEdgeAiSetup } from "./edgeAiValidation.ts";
import { edgeAiDataQuality } from "./candidateDataQuality";
import { verifiedUnderlyingAtr } from "@workspace/market-calendar/research-policy";

export type EdgeAiCategory = "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST";
export type EdgeAiMarket = "SE" | "US";

export function mapEdgeAiCategory(
  direction: "LONG" | "SHORT",
  setupName: string,
): EdgeAiCategory {
  if (direction === "SHORT") return "WEAKEST";
  const n = setupName.toLowerCase();
  if (n.includes("squeeze") || n.includes("bollinger") || n.includes("reversion") || n.includes("mean"))
    return "SQUEEZE";
  if (n.includes("pullback") || n.includes("stud") || n.includes("reversal"))
    return "STUDS";
  return "MOMENTUM"; // breakout, momentum, flag, trend, default
}

/**
 * Maps one raw EdgeAI setup to a candidate row. `rankCounter` is a caller-owned
 * dict used to assign a 1-based rank within each `${market}:${category}` bucket
 * — pass a fresh dict per session, and the same dict across markets is safe
 * since the key already includes the market.
 */
export function mapEdgeAiSetup(
  s: any,
  market: EdgeAiMarket,
  rankCounter: Record<string, number>,
  dataAsOf: string | null = null,
) {
  const setupErrors = validateEdgeAiSetup(s, market);
  if (setupErrors.length) throw new Error(`Invalid EdgeAI setup: ${setupErrors.join("; ")}`);
  const direction = edgeAiDirection(s.dir);
  const category = mapEdgeAiCategory(direction, s.setup ?? "");
  const rankKey = `${market}:${category}`;
  rankCounter[rankKey] = (rankCounter[rankKey] ?? 0) + 1;

  const entry = Number(s.entry);
  const stop = Number(s.stop);
  const oneR = Math.abs(entry - stop);
  // Use EdgeAI's own calibrated target — it reflects the system's actual back-tested level.
  // Forcing a fixed R:R would reduce win rate below the system's calibration.
  const targetPrice = Number(s.target);
  const reward = direction === "SHORT" ? entry - targetPrice : targetPrice - entry;
  const rr = oneR > 0 && reward > 0 ? reward / oneR : 0;
  // Strip .ST so resolveYahooTicker can re-add it correctly for SE stocks;
  // US tickers have no .ST so this is a no-op for them.
  const ticker = String(s.ticker ?? "").replace(/\.ST$/i, "").toUpperCase();
  // barsAgo: how many bars (trading days) ago the signal was first triggered
  const barsAgo = Number(s.barsAgo);
  const chart = Array.isArray(s.chart) ? s.chart : [];
  const signalChart = barsAgo > 0
    ? chart.slice(0, Math.max(0, chart.length - Math.floor(barsAgo)))
    : chart;
  const signalRsi = calculateWilderRsi(signalChart.map((bar: any) => Number(bar?.c)));
  const signalGapPct = calculateOpeningGapPct(signalChart);
  const edgeWinRateRaw = Number(s.edge.winRate);
  const edgeWinRate = edgeWinRateRaw > 1 ? edgeWinRateRaw / 100 : edgeWinRateRaw;
  const edgeExpectancyR = Number(s.edge.expectancyR);
  const edgeSampleN = edgeAiSampleN(s.edge);
  const maxHoldDays = category === "SQUEEZE" ? 15 : category === "STUDS" ? 5 : 10;
  const atrEvidence=verifiedUnderlyingAtr(s.atrEvidence,ticker,market,dataAsOf);

  return {
    market,
    dataQuality: {...edgeAiDataQuality(s, dataAsOf),...(atrEvidence?{atrEvidence}:{})},
    signalDate: edgeAiSignalDate(s.signalT, market),
    category,
    rank: rankCounter[rankKey],
    ticker,
    price: entry,
    rs3m: Number(s.rs),
    // These conventional screener columns do not describe EdgeAI statistics.
    // Keep schema-required fields neutral; use the dedicated fields below.
    perf1m: 0,
    rsi: 0,
    pctB: 0,
    atr: atrEvidence?.value ?? 0, // legacy schema needs a number; zero remains unknown, never qualified
    volMultiplier: 0, // filled only from a verified completed Yahoo daily bar
    volumeAsOf: null as string | null,
    earningsInDays: null as number | null,
    earningsKnowledge: "UNKNOWN" as "SIGNAL_TIME" | "UNKNOWN",
    earningsObservedAt: null as Date | null,
    distFrom20dH: 0,
    signalRsi,
    signalGapPct,
    edgeWinRate,
    edgeExpectancyR,
    edgeSampleN,
    signalAgeBars: Math.floor(barsAgo),
    maxHoldDays,
    gapWarning: signalGapPct != null && Math.abs(signalGapPct) >= 2.5 ? signalGapPct : null,
    direction,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice,
    rr,
    oneR,
    outcome: "PENDING" as const,
  };
}
