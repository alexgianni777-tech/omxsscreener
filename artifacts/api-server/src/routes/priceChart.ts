/**
 * GET /api/screener/price-chart/:ticker
 *
 * Returns daily OHLCV candles (90 days) + pre-computed Bollinger Bands (20-period, 2σ).
 * Ticker may be a bare symbol (AAPL, ERIC-B) or include .ST suffix — both accepted.
 * The resolveYahooTicker helper adds .ST for SE stocks automatically.
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

router.get("/screener/price-chart/:ticker", async (req, res): Promise<void> => {
  const raw = req.params.ticker;
  const yahoo = resolveYahooTicker(raw);

  const end = new Date();
  // Fetch 130 days so we have enough warm-up for the 20-period BB
  const start = new Date(end.getTime() - 130 * 86_400_000);

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

  // Build candle array — lightweight-charts needs 'time' as YYYY-MM-DD string
  const candles = history.map((h) => ({
    time: new Date(h.date).toISOString().slice(0, 10),
    open: Number(h.open?.toFixed(4) ?? h.close),
    high: Number(h.high?.toFixed(4) ?? h.close),
    low: Number(h.low?.toFixed(4) ?? h.close),
    close: Number(h.close?.toFixed(4)),
    volume: h.volume ?? 0,
  }));

  // Bollinger Bands
  const closes = history.map((h) => h.close);
  const bb = computeBollinger(closes, 20, 2);

  // Trim to last 90 candles for display (keep 130 for BB warmup, return last 90)
  const displayCount = Math.min(90, candles.length);
  const displayFrom = candles.length - displayCount;

  const displayCandles = candles.slice(displayFrom);
  const displayBB = bb.slice(displayFrom);

  const upper = displayBB
    .map((b, i) => b.upper != null ? { time: displayCandles[i].time, value: b.upper } : null)
    .filter(Boolean) as { time: string; value: number }[];
  const middle = displayBB
    .map((b, i) => b.middle != null ? { time: displayCandles[i].time, value: b.middle } : null)
    .filter(Boolean) as { time: string; value: number }[];
  const lower = displayBB
    .map((b, i) => b.lower != null ? { time: displayCandles[i].time, value: b.lower } : null)
    .filter(Boolean) as { time: string; value: number }[];

  res.json({
    ticker: raw.toUpperCase(),
    yahooTicker: yahoo,
    candles: displayCandles,
    bollinger: { upper, middle, lower },
  });
});

export default router;
