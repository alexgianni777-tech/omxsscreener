export type EarningsMarket = "SE" | "US";
export type ReactionStatus = "AVAILABLE" | "MISSING" | "CONFLICT";

export interface OhlcvBar {
  date: Date | string;
  open: number | null | undefined;
  high: number | null | undefined;
  low: number | null | undefined;
  close: number | null | undefined;
  volume?: number | null;
}

export interface IntradayBar extends OhlcvBar {
  date: Date | string;
}

export interface NormalizedIntradayBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface EarningsDailyReaction {
  status: ReactionStatus;
  reportDate: string;
  timezone: string;
  dataAsOf: string | null;
  previousClose: { date: string; close: number } | null;
  reportDay: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  } | null;
  changePct: {
    open: number;
    high: number;
    low: number;
    close: number;
  } | null;
  postReport: Array<{
    sessions: 1 | 3 | 5;
    date: string | null;
    close: number | null;
    returnPct: number | null;
  }>;
  reason: string | null;
}

export function earningsTimezone(market: EarningsMarket): string {
  return market === "US" ? "America/New_York" : "Europe/Stockholm";
}

export function marketDate(value: Date | string | number, market: EarningsMarket): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: earningsTimezone(market),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeDailyBars(
  input: readonly OhlcvBar[],
  market: EarningsMarket,
): { bars: Array<OhlcvBar & { date: string }>; conflictDates: Set<string> } {
  const byDate = new Map<string, OhlcvBar & { date: string }>();
  const conflictDates = new Set<string>();
  for (const raw of input) {
    const date = marketDate(raw.date, market);
    if (!date) continue;
    const current = { ...raw, date };
    const previous = byDate.get(date);
    if (previous) {
      const same = ["open", "high", "low", "close", "volume"].every((key) =>
        (previous as any)[key] === (current as any)[key],
      );
      if (!same) conflictDates.add(date);
      continue;
    }
    byDate.set(date, current);
  }

  return {
    bars: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    conflictDates,
  };
}

function validOhlc(bar: OhlcvBar): boolean {
  return finitePositive(bar.open) &&
    finitePositive(bar.high) &&
    finitePositive(bar.low) &&
    finitePositive(bar.close) &&
    bar.high >= Math.max(bar.open, bar.close) &&
    bar.low <= Math.min(bar.open, bar.close) &&
    bar.high >= bar.low &&
    (bar.volume == null || (Number.isFinite(bar.volume) && bar.volume >= 0));
}

function pct(value: number, base: number): number | null {
  if (!finitePositive(value) || !finitePositive(base)) return null;
  const result = ((value - base) / base) * 100;
  return Number.isFinite(result) ? Number(result.toFixed(4)) : null;
}

export function buildEarningsDailyReaction(
  input: readonly OhlcvBar[],
  reportDate: string,
  market: EarningsMarket,
): EarningsDailyReaction {
  const timezone = earningsTimezone(market);
  const normalized = normalizeDailyBars(input, market);
  const dataAsOf = normalized.bars.at(-1)?.date ?? null;
  const emptyPostReport = ([1, 3, 5] as const).map((sessions) => ({
    sessions, date: null, close: null, returnPct: null,
  }));

  const index = normalized.bars.findIndex((bar) => bar.date === reportDate);
  if (index < 0) {
    return {
      status: "MISSING", reportDate, timezone, dataAsOf, previousClose: null,
      reportDay: null, changePct: null, postReport: emptyPostReport,
      reason: "Ingen exakt dagsstapel finns för rapportdagen.",
    };
  }

  const event = normalized.bars[index];
  const previous = normalized.bars[index - 1];
  const following = normalized.bars.slice(index + 1, index + 6);
  const relevantBars = [event, ...(previous ? [previous] : []), ...following];
  if (relevantBars.some((bar) => normalized.conflictDates.has(bar.date))) {
    return {
      status: "CONFLICT", reportDate, timezone, dataAsOf, previousClose: null,
      reportDay: null, changePct: null, postReport: emptyPostReport,
      reason: "Flera olika dagsstaplar finns för samma datum i rapportfönstret.",
    };
  }
  if (relevantBars.some((bar) => !validOhlc(bar))) {
    return {
      status: "CONFLICT", reportDate, timezone, dataAsOf, previousClose: null,
      reportDay: null, changePct: null, postReport: emptyPostReport,
      reason: "OHLC-värdena är oförenliga eller ofullständiga; reaktionen visas inte.",
    };
  }

  const previousClose = previous
    ? { date: previous.date, close: previous.close as number }
    : null;
  const reportDay = {
    date: event.date,
    open: event.open as number,
    high: event.high as number,
    low: event.low as number,
    close: event.close as number,
    volume: typeof event.volume === "number" && Number.isFinite(event.volume) ? event.volume : null,
  };
  const changePct = previousClose
    ? {
        open: pct(reportDay.open, previousClose.close)!,
        high: pct(reportDay.high, previousClose.close)!,
        low: pct(reportDay.low, previousClose.close)!,
        close: pct(reportDay.close, previousClose.close)!,
      }
    : null;

  const postReport = ([1, 3, 5] as const).map((sessions) => {
    const bar = normalized.bars[index + sessions];
    return {
      sessions,
      date: bar?.date ?? null,
      close: bar?.close ?? null,
      returnPct: bar ? pct(bar.close as number, reportDay.close) : null,
    };
  });

  return {
    status: previousClose ? "AVAILABLE" : "MISSING",
    reportDate,
    timezone,
    dataAsOf,
    previousClose,
    reportDay,
    changePct,
    postReport,
    reason: previousClose ? null : "Föregående stängning saknas i källans historik.",
  };
}

export function normalizeIntradayBars(
  input: readonly IntradayBar[],
  reportDate: string,
  market: EarningsMarket,
): { status: ReactionStatus; candles: NormalizedIntradayBar[]; asOf: string | null; reason: string | null } {
  const byTime = new Map<string, NormalizedIntradayBar>();
  for (const raw of input) {
    const instant = raw.date instanceof Date ? raw.date : new Date(raw.date);
    if (!Number.isFinite(instant.getTime()) || marketDate(instant, market) !== reportDate) continue;
    if (![raw.open, raw.high, raw.low, raw.close].every(finitePositive)) continue;
    if (!validOhlc(raw)) {
      return { status: "CONFLICT", candles: [], asOf: null, reason: "Minutstapeln innehåller oförenliga OHLC-värden." };
    }
    const timestamp = instant.toISOString();
    const candle: NormalizedIntradayBar = {
      timestamp,
      open: raw.open as number,
      high: raw.high as number,
      low: raw.low as number,
      close: raw.close as number,
      volume: typeof raw.volume === "number" && Number.isFinite(raw.volume) && raw.volume >= 0
        ? raw.volume : null,
    };
    const existing = byTime.get(timestamp);
    if (existing && JSON.stringify(existing) !== JSON.stringify(candle)) {
      return { status: "CONFLICT", candles: [], asOf: null, reason: "Olika minutstaplar har samma tidsstämpel." };
    }
    byTime.set(timestamp, candle);
  }

  const candles = [...byTime.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!candles.length) {
    return { status: "MISSING", candles, asOf: null, reason: "Historisk minutdata saknas för rapportdagen." };
  }
  return { status: "AVAILABLE", candles, asOf: candles[candles.length - 1].timestamp, reason: null };
}

export function isDailyHistoryStale(
  priceDataAsOf: string | null,
  marketQuoteAsOf: Date | string | null,
  market: EarningsMarket,
  now = new Date(),
): boolean | null {
  if (!priceDataAsOf || !marketQuoteAsOf) return null;
  const quoteDate = marketDate(marketQuoteAsOf, market);
  const today = marketDate(now, market);
  if (!quoteDate || !today || priceDataAsOf > today || quoteDate > today) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: earningsTimezone(market), hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const minute = Number(parts.find(p => p.type === "hour")?.value) * 60 + Number(parts.find(p => p.type === "minute")?.value);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  // Allow providers one hour after regular close to finalize the daily bar.
  const expected = weekday !== 0 && weekday !== 6 && minute >= (market === "US" ? 17 * 60 : 18 * 60 + 30)
    ? today : adjacentWeekday(today, -1);
  const oldest = priceDataAsOf < quoteDate ? priceDataAsOf : quoteDate;
  if (oldest >= expected) return false;
  // Without a full exchange holiday calendar a single missing weekday may be
  // a holiday: UNKNOWN, never CURRENT. Two missing weekdays are plainly stale.
  return oldest < adjacentWeekday(expected, -1) ? true : null;
}

function adjacentWeekday(date: string, direction: 1 | -1): string {
  const value = new Date(`${date}T12:00:00Z`);
  do { value.setUTCDate(value.getUTCDate() + direction); }
  while (value.getUTCDay() === 0 || value.getUTCDay() === 6);
  return value.toISOString().slice(0, 10);
}

/** A period end or date-only provider placeholder is not a publication time. */
export function publicationTimestamp(value: unknown): string | null {
  if (!(value instanceof Date) && (typeof value !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value))) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(11, 19) === "00:00:00") return null;
  return date.toISOString();
}

export function buildPublicationReaction(
  input: readonly OhlcvBar[], publication: unknown, market: EarningsMarket, now = new Date(),
) {
  const timestamp = publicationTimestamp(publication);
  const reportDate = timestamp ? marketDate(timestamp, market) : null;
  const dataAsOf = normalizeDailyBars(input, market).bars.at(-1)?.date ?? null;
  const empty = {
    reportDate, reportTimestamp: timestamp, reactionDate: null as string | null, releaseSession: "UNKNOWN",
    timezone: earningsTimezone(market), dataAsOf, previousClose: null, reportDay: null, changePct: null,
    postReport: ([1, 3, 5] as const).map(sessions => ({ sessions, date: null, close: null, returnPct: null })),
  };
  if (!timestamp || !reportDate) return { ...empty, status: "MISSING" as const, reason: "Verklig publiceringstid saknas; kvartalsslut eller datum utan tid används inte som rapportreaktion." };
  if (Date.parse(timestamp) > now.getTime()) return { ...empty, status: "UPCOMING" as const, reason: "Rapportens publiceringstid ligger framåt i tiden." };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: earningsTimezone(market), hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const minute = Number(parts.find(p => p.type === "hour")?.value) * 60 + Number(parts.find(p => p.type === "minute")?.value);
  const opening = market === "US" ? 9 * 60 + 30 : 9 * 60;
  const closing = market === "US" ? 16 * 60 : 17 * 60 + 30;
  const weekday = new Date(`${reportDate}T12:00:00Z`).getUTCDay();
  const afterClose = minute >= closing || weekday === 0 || weekday === 6;
  const releaseSession = afterClose ? "AFTER_CLOSE" : minute < opening ? "PRE_MARKET" : "INTRADAY";
  if (releaseSession === "INTRADAY") return {
    ...empty, releaseSession, status: "MISSING" as const,
    reason: "Rapport under handel: dags-OHLC innehåller priser före publicering. Använd tidsstämplad minutdata; ingen dagsreaktion uppskattas.",
  };
  const reactionDate = afterClose ? adjacentWeekday(reportDate, 1) : reportDate;
  // A historical bar must itself be completed, not the current partial day.
  const today = marketDate(now, market);
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: earningsTimezone(market), hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const nowMinute = Number(nowParts.find(p => p.type === "hour")?.value) * 60 + Number(nowParts.find(p => p.type === "minute")?.value);
  if (reactionDate > (today ?? "") || reactionDate === today && nowMinute < closing + 60) return {
    ...empty, releaseSession, reactionDate, status: "MISSING" as const,
    reason: "Reaktionsdagens fullständiga stängningsstapel är inte tillgänglig ännu.",
  };
  return { ...buildEarningsDailyReaction(input, reactionDate, market), reportDate, reportTimestamp: timestamp, reactionDate, releaseSession };
}

function exchangeMidnightUtc(date: string, timezone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const localDateAsUtc = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(localDateAsUtc.getTime()) || localDateAsUtc.toISOString().slice(0, 10) !== date) return null;
  let guess = localDateAsUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const localTimeAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const next = new Date(guess.getTime() + localDateAsUtc.getTime() - localTimeAsUtc);
    if (next.getTime() === guess.getTime()) return next;
    guess = next;
  }
  return guess;
}

export function marketDayUtcBounds(
  date: string,
  market: EarningsMarket,
): { start: Date; end: Date } | null {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(nextDate.getTime()) || nextDate.toISOString().slice(0, 10) !== date) return null;
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateString = nextDate.toISOString().slice(0, 10);
  const start = exchangeMidnightUtc(date, earningsTimezone(market));
  const end = exchangeMidnightUtc(nextDateString, earningsTimezone(market));
  return start && end ? { start, end } : null;
}
