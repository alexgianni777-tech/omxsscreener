/**
 * GET /api/screener/price-chart/:ticker?days=N
 *
 * Returns daily OHLCV candles + pre-computed Bollinger Bands (20-period, 2σ)
 * + RSI(14).  Default display window = 90 days, max 365.
 *
 * Ticker may be a bare symbol (AAPL, ERIC-B) or include .ST suffix — both accepted.
 */
import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// ── Bollinger Bands ───────────────────────────────────────────────────────────
function computeBollinger(
  closes: number[],
  period = 20,
  multiplier = 2,
): { upper: number | null; middle: number | null; lower: number | null }[] {
  return closes.map((_, i) => {
    if (i < period - 1) return { upper: null, middle: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - sma) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return {
      upper: Number((sma + multiplier * std).toFixed(4)),
      middle: Number(sma.toFixed(4)),
      lower: Number((sma - multiplier * std).toFixed(4)),
    };
  });
}

// ── RSI ───────────────────────────────────────────────────────────────────────
function computeRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  // Build gains / losses arrays (length = closes.length - 1)
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  // Seed using simple average of first `period` changes → RSI for close[period]
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  result[period] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + rs0)).toFixed(2));

  // Wilder smooth for the rest
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result[i + 1] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + rs)).toFixed(2));
  }

  return result;
}

router.get("/screener/price-chart/:ticker", async (req, res): Promise<void> => {
  const raw = req.params.ticker;
  const yahoo = resolveYahooTicker(raw);

  // Display window: default 90, capped at 365
  const reqDays = parseInt(String(req.query.days ?? "90"), 10);
  const displayDays = Math.min(Math.max(isNaN(reqDays) ? 90 : reqDays, 10), 365);

  // Fetch enough history for BB(20) + RSI(14) warmup
  const warmup = 34; // 20 (BB) + 14 (RSI) = 34, round up to be safe
  const fetchDays = displayDays + warmup + 10; // extra buffer for weekends/holidays

  const end = new Date();
  const start = new Date(end.getTime() - fetchDays * 86_400_000);

  let history: { date: Date; open: number; high: number; low: number; close: number; volume: number }[];
  try {
    history = (await yf.historical(yahoo, {
      period1: start,
      period2: end,
      interval: "1d",
    })) as typeof history;
  } catch (err: any) {
    res.status(502).json({ error: `Yahoo Finance error: ${err.message}` });
    return;
  }

  if (!history || history.length === 0) {
    res.status(404).json({ error: "No price data found for " + yahoo });
    return;
  }

  // Sort ascending
  history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Build full candle array
  const allCandles = history.map((h) => ({
    time: new Date(h.date).toISOString().slice(0, 10),
    open: Number(h.open?.toFixed(4) ?? h.close),
    high: Number(h.high?.toFixed(4) ?? h.close),
    low: Number(h.low?.toFixed(4) ?? h.close),
    close: Number(h.close?.toFixed(4)),
    volume: h.volume ?? 0,
  }));

  const closes = history.map((h) => h.close);

  // Compute indicators over full history
  const bb = computeBollinger(closes, 20, 2);
  const rsiAll = computeRSI(closes, 14);

  // Trim to display window
  const displayCount = Math.min(displayDays, allCandles.length);
  const displayFrom = allCandles.length - displayCount;

  const displayCandles = allCandles.slice(displayFrom);
  const displayBB = bb.slice(displayFrom);
  const displayRSI = rsiAll.slice(displayFrom);

  // Bollinger: filter nulls
  const upper = displayBB
    .map((b, i) => (b.upper != null ? { time: displayCandles[i].time, value: b.upper } : null))
    .filter(Boolean) as { time: string; value: number }[];
  const middle = displayBB
    .map((b, i) => (b.middle != null ? { time: displayCandles[i].time, value: b.middle } : null))
    .filter(Boolean) as { time: string; value: number }[];
  const lower = displayBB
    .map((b, i) => (b.lower != null ? { time: displayCandles[i].time, value: b.lower } : null))
    .filter(Boolean) as { time: string; value: number }[];

  // RSI: filter nulls
  const rsi = displayRSI
    .map((v, i) => (v != null ? { time: displayCandles[i].time, value: v } : null))
    .filter(Boolean) as { time: string; value: number }[];

  res.json({
    ticker: raw.toUpperCase(),
    yahooTicker: yahoo,
    candles: displayCandles,
    bollinger: { upper, middle, lower },
    rsi,
  });
});

export default router;
