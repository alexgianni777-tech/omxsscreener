import { withRetry } from "./retry.ts";

type Market = "SE" | "US";

type HistoricalBar = {
  date: Date | string | number;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
};

type YahooHistoryClient = {
  historical: (
    ticker: string,
    options: { period1: Date; period2: Date; interval: "1d" },
  ) => Promise<unknown>;
};

function formatDate(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null;
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function barDate(value: HistoricalBar["date"]): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return formatDate(date);
}

function isCurrentSessionIncomplete(asOfDate: string, market: Market): boolean {
  const timeZone = market === "SE" ? "Europe/Stockholm" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  if (asOfDate !== today) return false;

  const localMinutes = Number(part("hour")) * 60 + Number(part("minute"));
  const cutoffMinutes = market === "SE" ? 19 * 60 : 17 * 60 + 30;
  return localMinutes < cutoffMinutes;
}

/**
 * Fetches a completed daily volume bar and compares it with the prior ten
 * positive-volume daily bars. The current session is deliberately not used.
 */
export async function fetchCompletedVolumeMultiplier(
  yf: YahooHistoryClient,
  ticker: string,
  asOfDate: string,
  market: Market,
): Promise<{ multiplier: number; asOf: string } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;
  const asOf = new Date(`${asOfDate}T00:00:00.000Z`);
  if (formatDate(asOf) !== asOfDate || isCurrentSessionIncomplete(asOfDate, market)) return null;

  const period1 = new Date(asOf.getTime() - 30 * 86_400_000);
  const period2 = new Date(asOf.getTime() + 86_400_000);
  let history: unknown;
  try {
    history = await withRetry(() => yf.historical(ticker, { period1, period2, interval: "1d" }));
  } catch {
    return null;
  }
  if (!Array.isArray(history)) return null;

  const bars = (history as HistoricalBar[])
    .map((bar) => ({ bar, date: bar?.date == null ? null : barDate(bar.date) }))
    .filter((entry): entry is { bar: HistoricalBar; date: string } => entry.date !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const targetIndex = bars.findIndex((entry) => entry.date === asOfDate);
  if (targetIndex < 0) return null;

  const target = bars[targetIndex].bar;
  const targetValues = [target.open, target.high, target.low, target.close, target.volume].map(Number);
  if (targetValues.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const targetVolume = targetValues[4];

  const priorVolumes = bars
    .slice(0, targetIndex)
    .map(({ bar }) => {
      const values = [bar.open, bar.high, bar.low, bar.close, bar.volume].map(Number);
      return values.every((value) => Number.isFinite(value) && value > 0) ? values[4] : null;
    })
    .filter((volume): volume is number => volume !== null)
    .slice(-10);
  if (priorVolumes.length !== 10) return null;

  const averageVolume = priorVolumes.reduce((sum, volume) => sum + volume / 10, 0);
  if (!Number.isFinite(averageVolume) || averageVolume <= 0) return null;
  const ratio = targetVolume / averageVolume;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const roundedRatio = Math.round(ratio * 100) / 100;
  return {
    multiplier: roundedRatio === 0 ? ratio : roundedRatio,
    asOf: asOfDate,
  };
}