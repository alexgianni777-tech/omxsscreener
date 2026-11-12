export type PriceBar = {
  o?: number;
  c?: number;
};

/**
 * Wilder RSI: seed with `period` changes, then smooth every remaining bar.
 * Upstream mini-charts have 22 bars; standard RSI(14) requires 15, not 29.
 * Missing prices are not silently bridged into a fabricated continuous series.
 */
export function calculateWilderRsi(closes: number[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1 ||
      closes.length < period + 1 ||
      closes.some((close) => !Number.isFinite(close) || close <= 0)) return null;
  const valid = closes;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index++) {
    const delta = valid[index] - valid[index - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < valid.length; index++) {
    const delta = valid[index] - valid[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return Math.round((100 - 100 / (1 + relativeStrength)) * 10) / 10;
}

/** Opening gap from the previous close to the latest bar's open. */
export function calculateOpeningGapPct(chart: PriceBar[] | undefined): number | null {
  if (!chart || chart.length < 2) return null;
  const previousClose = Number(chart.at(-2)?.c);
  const latestOpen = Number(chart.at(-1)?.o);
  if (!Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(latestOpen)) {
    return null;
  }
  return Math.round(((latestOpen - previousClose) / previousClose) * 100 * 1000) / 1000;
}

export function volumeMultiplierFromQuote(quote: {
  regularMarketVolume?: number | null;
  averageDailyVolume10Day?: number | null;
  averageDailyVolume3Month?: number | null;
}): number | null {
  const volume = Number(quote.regularMarketVolume ?? 0);
  const average10d = Number(quote.averageDailyVolume10Day ?? 0);
  if (average10d > 0 && volume / average10d >= 0.2) {
    return Math.round((volume / average10d) * 10) / 10;
  }
  return null;
}