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

type DatedBar = { bar: HistoricalBar; date: string };

function verifiedRatio(bars: DatedBar[], targetIndex: number): { multiplier: number; asOf: string } | null {
  if (targetIndex < 0) return null;
  const target = bars[targetIndex].bar;
  const targetValues = [target.open, target.high, target.low, target.close, target.volume].map(Number);
  if (targetValues.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const priorVolumes = bars.slice(0, targetIndex).map(({ bar }) => {
    const values = [bar.open, bar.high, bar.low, bar.close, bar.volume].map(Number);
    return values.every((value) => Number.isFinite(value) && value > 0) ? values[4] : null;
  }).filter((volume): volume is number => volume !== null).slice(-10);
  if (priorVolumes.length !== 10) return null;
  const average = priorVolumes.reduce((sum, volume) => sum + volume / 10, 0);
  const ratio = targetValues[4] / average;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const rounded = Math.round(ratio * 100) / 100;
  return { multiplier: rounded === 0 ? ratio : rounded, asOf: bars[targetIndex].date };
}

async function historyBars(yf: YahooHistoryClient, ticker: string, period1: Date, period2: Date): Promise<DatedBar[] | null> {
  let history: unknown;
  try {
    history = await withRetry(() => yf.historical(ticker, { period1, period2, interval: "1d" }));
  } catch {
    return null;
  }
  if (!Array.isArray(history)) return null;
  return (history as HistoricalBar[])
    .map((bar) => ({ bar, date: bar?.date == null ? null : barDate(bar.date) }))
    .filter((entry): entry is DatedBar => entry.date !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

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

export function isCurrentSessionIncomplete(asOfDate: string, market: Market): boolean {
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

  const period1 = new Date(asOf.getTime() - 45 * 86_400_000);
  const period2 = new Date(asOf.getTime() + 86_400_000);
  const bars = await historyBars(yf, ticker, period1, period2);
  if (!bars) return null;
  const targetIndex = bars.findIndex((entry) => entry.date === asOfDate);
  return verifiedRatio(bars, targetIndex);
}

/**
 * Signal-day intraday imports cannot use a partial current-day daily bar.
 * Verify the latest earlier completed trading bar instead, preserving its
 * actual date. This is previous-day context, not today's live volume.
 */
export async function fetchPriorCompletedVolumeMultiplier(
  yf: YahooHistoryClient,
  ticker: string,
  signalDate: string,
): Promise<{ multiplier: number; asOf: string } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) return null;
  const start = new Date(`${signalDate}T00:00:00.000Z`);
  if (formatDate(start) !== signalDate) return null;
  const bars = await historyBars(yf, ticker, new Date(start.getTime() - 45 * 86_400_000), start);
  if (!bars) return null;
  let targetIndex = bars.length - 1;
  while (targetIndex >= 0 && bars[targetIndex].date >= signalDate) targetIndex--;
  if (targetIndex < 0) return null;
  const barDay = new Date(`${bars[targetIndex].date}T00:00:00.000Z`);
  if (start.getTime() - barDay.getTime() > 10 * 86_400_000) return null;
  return verifiedRatio(bars, targetIndex);
}