import { calculateWilderRsi } from "./marketIndicators";
import { withRetry } from "./retry";
import { isCurrentSessionIncomplete, type fetchCompletedVolumeMultiplier } from "./completedVolume";

type YahooHistoryClient = Parameters<typeof fetchCompletedVolumeMultiplier>[0];

export type OmxsMarketWeather = {
  omxsValue: number;
  perf5d: number;
  perf1m: number;
  perf3m: number;
  marketRsi: number;
};

/**
 * EdgeAI's generation day can be newer than its underlying daily candles.
 * Use the index close from the same completed data day as the SE setups,
 * never an intraday candle from the import day.
 */
export async function fetchOmxsMarketWeather(
  yf: YahooHistoryClient,
  dataAsOf: string,
): Promise<OmxsMarketWeather> {
  const asOf = new Date(`${dataAsOf}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAsOf) ||
      !Number.isFinite(asOf.getTime()) ||
      asOf.toISOString().slice(0, 10) !== dataAsOf) {
    throw new Error(`Invalid EdgeAI SE dataAsOf: ${dataAsOf}`);
  }
  if (isCurrentSessionIncomplete(dataAsOf, "SE")) {
    throw new Error(`OMXS30 daily bar for ${dataAsOf} is not complete yet`);
  }

  const history = await withRetry(() => yf.historical("^OMX", {
    period1: new Date(asOf.getTime() - 95 * 86_400_000),
    period2: new Date(asOf.getTime() + 86_400_000),
    interval: "1d",
  }));
  if (!Array.isArray(history)) throw new Error("OMXS30 daily history unavailable");

  const bars = (history as Array<{ date?: unknown; close?: unknown }>)
    .map((bar) => {
      const date = new Date(bar.date as string | number | Date);
      return {
        date: Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "",
        close: Number(bar.close),
      };
    })
    .filter((bar) => bar.date <= dataAsOf && bar.date !== "" &&
      Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.at(-1)?.date !== dataAsOf) {
    throw new Error(`OMXS30 closed daily bar missing for EdgeAI SE dataAsOf ${dataAsOf}`);
  }

  const closes = bars.map((bar) => bar.close);
  const omxsValue = closes[closes.length - 1];
  const performance = (days: number) =>
    closes.length > days ? ((omxsValue - closes[closes.length - 1 - days]) /
      closes[closes.length - 1 - days]) * 100 : 0;

  return {
    omxsValue,
    perf5d: performance(5),
    perf1m: performance(21),
    perf3m: performance(63),
    marketRsi: calculateWilderRsi(closes) ?? 0,
  };
}