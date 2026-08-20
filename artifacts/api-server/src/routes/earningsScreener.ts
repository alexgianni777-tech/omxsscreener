/**
 * GET /api/screener/earnings-screener
 *
 * Scans the OMXS30 universe + current EdgeAI US picks for upcoming earnings
 * (next 21 days) and recently reported (last 7 days). For each relevant stock:
 *   - Historical beat/miss rate + average EPS surprise %
 *   - Analyst estimate revisions (last 30 days)
 *   - Average day +1 price reaction across past earnings events
 *   - Current live price + next EPS estimate
 *
 * NOTE: This is historical fundamental data, not a technical signal.
 * Day +1 return = (close[date+1] - close[date-1]) / close[date-1] × 100.
 */
import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { calendarDaysBetween, utcCalendarDate } from "../lib/marketCalendar";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// ── Simple in-memory cache (10 min TTL) ──────────────────────────────────────
let cache: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * yahoo-finance2 has returned both QuoteSummary modules with `{ raw }`
 * wrappers and plain primitive values across versions. Keep the route tolerant
 * of both shapes so valid earnings data does not become null in the UI.
 */
function yahooValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "object" && "raw" in value) {
    return (value as { raw?: unknown }).raw ?? null;
  }
  return value;
}

function yahooNumber(value: unknown): number | null {
  const raw = yahooValue(value);
  if (raw == null || raw === "") return null;
  const number = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(number) ? number : null;
}

function yahooDate(value: unknown): Date | null {
  const raw = yahooValue(value);
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw : null;
  }
  if (typeof raw === "number") {
    const date = new Date(raw < 1_000_000_000_000 ? raw * 1_000 : raw);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

// ── OMXS30 universe ──────────────────────────────────────────────────────────
const OMXS30_TICKERS: { yahoo: string; display: string }[] = [
  { yahoo: "ABB.ST",       display: "ABB" },
  { yahoo: "ALFA.ST",      display: "Alfa Laval" },
  { yahoo: "ALIV-SDB.ST",  display: "Autoliv" },
  { yahoo: "ATCO-A.ST",    display: "Atlas Copco A" },
  { yahoo: "AZN.ST",       display: "AstraZeneca" },
  { yahoo: "BOL.ST",       display: "Boliden" },
  { yahoo: "ELUX-B.ST",    display: "Electrolux" },
  { yahoo: "EPIR-A.ST",    display: "Epiroc" },
  { yahoo: "ERIC-B.ST",    display: "Ericsson" },
  { yahoo: "ESSITY-B.ST",  display: "Essity" },
  { yahoo: "EVO.ST",       display: "Evolution" },
  { yahoo: "GETI-B.ST",    display: "Getinge" },
  { yahoo: "HEXA-B.ST",    display: "Hexagon" },
  { yahoo: "HM-B.ST",      display: "H&M" },
  { yahoo: "HUSQ-B.ST",    display: "Husqvarna" },
  { yahoo: "INVE-B.ST",    display: "Investor" },
  { yahoo: "KINV-B.ST",    display: "Kinnevik" },
  { yahoo: "NDA-SE.ST",    display: "Nordea" },
  { yahoo: "NIBE-B.ST",    display: "Nibe" },
  { yahoo: "SAAB-B.ST",    display: "Saab" },
  { yahoo: "SAND.ST",      display: "Sandvik" },
  { yahoo: "SEB-A.ST",     display: "SEB" },
  { yahoo: "SHB-A.ST",     display: "Handelsbanken" },
  { yahoo: "SINCH.ST",     display: "Sinch" },
  { yahoo: "SKF-B.ST",     display: "SKF" },
  { yahoo: "SSAB-B.ST",    display: "SSAB" },
  { yahoo: "SWED-A.ST",    display: "Swedbank" },
  { yahoo: "SWMA.ST",      display: "Swedish Match" },
  { yahoo: "TELIA.ST",     display: "Telia" },
  { yahoo: "VOLV-B.ST",    display: "Volvo" },
];

// ── Extra SE watchlist (mid/small-cap utanför OMXS30) ────────────────────────
const SE_WATCHLIST_TICKERS: { yahoo: string; display: string }[] = [
  { yahoo: "EMBRAC-B.ST", display: "Embracer" },
  { yahoo: "RVRC.ST",     display: "Revolution Race" },
  { yahoo: "BORG.ST",     display: "Björn Borg" },
];

// ── Permanent US large-cap universe ──────────────────────────────────────────
const US_LARGE_CAP_TICKERS: { yahoo: string; display: string }[] = [
  // Magnificent 7
  { yahoo: "AAPL",  display: "Apple" },
  { yahoo: "MSFT",  display: "Microsoft" },
  { yahoo: "NVDA",  display: "Nvidia" },
  { yahoo: "AMZN",  display: "Amazon" },
  { yahoo: "GOOGL", display: "Alphabet" },
  { yahoo: "META",  display: "Meta" },
  { yahoo: "TSLA",  display: "Tesla" },
  // Financials
  { yahoo: "JPM",   display: "JPMorgan" },
  { yahoo: "V",     display: "Visa" },
  { yahoo: "MA",    display: "Mastercard" },
  { yahoo: "BAC",   display: "Bank of America" },
  { yahoo: "GS",    display: "Goldman Sachs" },
  // Healthcare
  { yahoo: "LLY",   display: "Eli Lilly" },
  { yahoo: "UNH",   display: "UnitedHealth" },
  { yahoo: "JNJ",   display: "Johnson & Johnson" },
  { yahoo: "ABBV",  display: "AbbVie" },
  { yahoo: "MRK",   display: "Merck" },
  // Consumer
  { yahoo: "WMT",   display: "Walmart" },
  { yahoo: "HD",    display: "Home Depot" },
  { yahoo: "COST",  display: "Costco" },
  { yahoo: "MCD",   display: "McDonald's" },
  { yahoo: "PG",    display: "Procter & Gamble" },
  { yahoo: "KO",    display: "Coca-Cola" },
  { yahoo: "PEP",   display: "PepsiCo" },
  // Tech / Semis
  { yahoo: "AVGO",  display: "Broadcom" },
  { yahoo: "ORCL",  display: "Oracle" },
  { yahoo: "CRM",   display: "Salesforce" },
  { yahoo: "ADBE",  display: "Adobe" },
  { yahoo: "NFLX",  display: "Netflix" },
  { yahoo: "AMD",   display: "AMD" },
  { yahoo: "QCOM",  display: "Qualcomm" },
  { yahoo: "INTC",  display: "Intel" },
  { yahoo: "MU",    display: "Micron" },
  // Energy / Industrial
  { yahoo: "XOM",   display: "ExxonMobil" },
  { yahoo: "CVX",   display: "Chevron" },
  { yahoo: "CAT",   display: "Caterpillar" },
  { yahoo: "RTX",   display: "RTX" },
  { yahoo: "HON",   display: "Honeywell" },
];

// ── Concurrency limiter ───────────────────────────────────────────────────────
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<(T | null)[]> {
  const results: (T | null)[] = new Array(tasks.length).fill(null);
  const queue = tasks.map((task, i) => ({ task, i }));
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try { results[item.i] = await item.task(); } catch { /* null stays */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ── Days from today ───────────────────────────────────────────────────────────
function daysFromToday(dt: Date | string | null | undefined): number | null {
  if (!dt) return null;
  const eventDate = dt instanceof Date ? dt : new Date(dt);
  return calendarDaysBetween(eventDate);
}

// ── Day-of-earnings price reaction ────────────────────────────────────────────
function computeDayPlusOneReturn(
  history: { date: Date; close: number }[],
  earningsDate: Date | string,
): number | null {
  const targetMs = new Date(earningsDate).getTime();
  if (isNaN(targetMs)) return null;
  const sorted = [...history]
    .map((h) => ({ ms: new Date(h.date).getTime(), close: h.close }))
    .sort((a, b) => a.ms - b.ms);

  // Find the last trading day on or before earningsDate
  let beforeIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].ms <= targetMs + 86_400_000) beforeIdx = i; // +1 day buffer
    else break;
  }
  // Clamp: we want the day *before* the earnings date
  while (beforeIdx > 0 && sorted[beforeIdx].ms > targetMs) beforeIdx--;

  if (beforeIdx < 0 || beforeIdx >= sorted.length - 1) return null;
  const before = sorted[beforeIdx].close;
  const after = sorted[beforeIdx + 1].close;
  if (!before) return null;
  return Number((((after - before) / before) * 100).toFixed(2));
}

// ── Main route ────────────────────────────────────────────────────────────────
router.get("/screener/earnings-screener", async (_req, res): Promise<void> => {
  // Serve from cache if still fresh
  if (cache && Date.now() < cache.expiresAt) {
    res.json(cache.data);
    return;
  }
  // 1. Get US tickers from latest EdgeAI session
  const omxsYahooSet = new Set(OMXS30_TICKERS.map((t) => t.yahoo));
  let usTickers: { yahoo: string; display: string }[] = [];
  try {
    // Use the most recent session regardless of source (edgeai, telegram, or manual)
    const [latestSession] = await db
      .select({ id: screenerSessionsTable.id })
      .from(screenerSessionsTable)
      .orderBy(desc(screenerSessionsTable.date))
      .limit(1);

    if (latestSession) {
      const cands = await db
        .select({ ticker: candidatesTable.ticker })
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, latestSession.id));

      usTickers = cands
        .map((c) => c.ticker.replace(/\.ST$/i, ""))
        .filter((t) => !omxsYahooSet.has(t + ".ST") && !omxsYahooSet.has(t))
        .filter((t, i, arr) => arr.indexOf(t) === i) // dedupe
        .map((t) => ({ yahoo: t, display: t }));
    }
  } catch {
    // non-fatal — proceed with OMXS30 only
  }

  // Merge permanent US large-caps with session picks (deduplicate by yahoo ticker)
  const usTickerSet = new Set(US_LARGE_CAP_TICKERS.map((t) => t.yahoo.toUpperCase()));
  const sessionOnlyTickers = usTickers.filter((t) => !usTickerSet.has(t.yahoo.toUpperCase()));
  const allUsTickers = [...US_LARGE_CAP_TICKERS, ...sessionOnlyTickers];

  const universe: { yahoo: string; display: string; market: "SE" | "US" }[] = [
    ...OMXS30_TICKERS.map((t) => ({ ...t, market: "SE" as const })),
    ...SE_WATCHLIST_TICKERS.map((t) => ({ ...t, market: "SE" as const })),
    ...allUsTickers.map((t) => ({ ...t, market: "US" as const })),
  ];

  // 2. Fetch quotes (earnings date) for all — concurrency 8
  const quoteResults = await withConcurrency(
    universe.map((stock) => async () => {
      const q = await yf.quote(stock.yahoo, {}, { validateResult: false });
      return {
        ...stock,
        earningsTimestamp: (q as any).earningsTimestamp as Date | null | undefined,
        livePrice: (q.regularMarketPrice ?? null) as number | null,
        changePct: (q.regularMarketChangePercent ?? null) as number | null,
      };
    }),
    8,
  );

  // 3. Filter to earnings within -7 to +21 days
  const relevant = quoteResults
    .filter(Boolean)
    .map((q) => ({ ...q!, earningsInDays: daysFromToday(q!.earningsTimestamp) }))
    .filter((q) => q.earningsInDays != null && q.earningsInDays >= -7 && q.earningsInDays <= 21)
    .sort((a, b) => (a.earningsInDays ?? 99) - (b.earningsInDays ?? 99));

  if (relevant.length === 0) {
    res.json({ stocks: [], generatedAt: new Date().toISOString() });
    return;
  }

  // 4. Fetch quoteSummary (earningsHistory + earningsTrend + financialData) — concurrency 4
  const summaryResults = await withConcurrency(
    relevant.map((stock) => async () => {
      const s = await yf.quoteSummary(stock.yahoo, {
        modules: ["earningsHistory", "earningsTrend", "financialData"],
      });
      return { ticker: stock.yahoo, summary: s };
    }),
    4,
  );

  // 5. Fetch 1-year historical prices — concurrency 4
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const historicalResults = await withConcurrency(
    relevant.map((stock) => async () => {
      const h = await yf.historical(stock.yahoo, {
        period1: oneYearAgo,
        period2: now,
        interval: "1d",
      });
      return { ticker: stock.yahoo, history: h as { date: Date; close: number }[] };
    }),
    4,
  );

  // 6. Build lookup maps
  const summaryMap = new Map(
    summaryResults.filter(Boolean).map((s) => [s!.ticker, s!.summary]),
  );
  const historyMap = new Map(
    historicalResults.filter(Boolean).map((h) => [h!.ticker, h!.history]),
  );

  // 7. Compute metrics per stock
  const stocks = relevant.map((stock) => {
    const summary = summaryMap.get(stock.yahoo);
    const history = historyMap.get(stock.yahoo) ?? [];

    // earningsHistory
    const rawHistory: any[] = (summary?.earningsHistory as any)?.history ?? [];
    type EarningsItem = {
      date: string;
      estimate: number | null;
      actual: number | null;
      surprisePct: number | null;
      dayPlusOneReturn: number | null;
      beat: boolean | null;
    };
    const historicalEarnings: EarningsItem[] = rawHistory.map((h: any) => {
      const estimate = yahooNumber(h.epsEstimate);
      const actual = yahooNumber(h.epsActual);
      const surpriseRaw = yahooNumber(h.surprisePercent);
      const surprisePct = surpriseRaw != null
        ? Number((surpriseRaw * 100).toFixed(2))
        : estimate != null && actual != null && estimate !== 0
        ? Number((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(2))
        : null;
      const quarterDate = yahooDate(h.quarter);
      const dayPlusOneReturn = quarterDate
        ? computeDayPlusOneReturn(history, quarterDate)
        : null;
      return {
        date: utcCalendarDate(quarterDate) ?? h.period ?? "?",
        estimate,
        actual,
        surprisePct,
        dayPlusOneReturn,
        beat: actual != null && estimate != null ? actual > estimate : null,
      };
    });

    const resolved = historicalEarnings.filter((e) => e.beat !== null);
    const beatRate = resolved.length > 0
      ? resolved.filter((e) => e.beat).length / resolved.length
      : null;
    const avgSurprisePct = historicalEarnings.filter((e) => e.surprisePct != null).length > 0
      ? Number(
          (
            historicalEarnings
              .filter((e) => e.surprisePct != null)
              .reduce((s, e) => s + e.surprisePct!, 0) /
            historicalEarnings.filter((e) => e.surprisePct != null).length
          ).toFixed(2),
        )
      : null;
    const d1Returns = historicalEarnings.filter((e) => e.dayPlusOneReturn != null);
    const avgDayPlusOneReturn = d1Returns.length > 0
      ? Number(
          (d1Returns.reduce((s, e) => s + e.dayPlusOneReturn!, 0) / d1Returns.length).toFixed(2),
        )
      : null;

    // earningsTrend — grab current quarter revision counts
    const trendArr: any[] = (summary?.earningsTrend as any)?.trend ?? [];
    const currentTrend = trendArr.find((t: any) => t.period === "0q") ?? trendArr[0];
    const revUp = yahooNumber(currentTrend?.epsRevisions?.upLast30days) ?? 0;
    const revDown = yahooNumber(currentTrend?.epsRevisions?.downLast30days) ?? 0;
    const nextEpsEstimate = yahooNumber(currentTrend?.earningsEstimate?.avg);

    // financialData — analyst consensus + price target
    const fd = (summary as any)?.financialData ?? {};
    const recommendationKey = (yahooValue(fd.recommendationKey) as string | null) ?? null; // "strong_buy" | "buy" | "hold" | "sell" | "strong_sell"
    const recommendationMean = yahooNumber(fd.recommendationMean); // 1.0–5.0
    const numberOfAnalystOpinions = yahooNumber(fd.numberOfAnalystOpinions);
    const targetMeanPrice = yahooNumber(fd.targetMeanPrice);
    const targetLowPrice = yahooNumber(fd.targetLowPrice);
    const targetHighPrice = yahooNumber(fd.targetHighPrice);
    const upsidePct: number | null =
      stock.livePrice && targetMeanPrice
        ? Number((((targetMeanPrice - stock.livePrice) / stock.livePrice) * 100).toFixed(1))
        : null;

    // ── Composite score (0–1) ────────────────────────────────────────────────
    // Weights: beat-rate 30%, avg EPS surprise 25%, dag+1 return 20%, consensus 25%
    let score = 0;
    let scoreComponents = 0;
    if (beatRate != null) { score += beatRate * 0.30; scoreComponents += 0.30; }
    if (avgSurprisePct != null) {
      // Normalize: -20% → 0, +20% → 1
      score += Math.min(Math.max((avgSurprisePct + 20) / 40, 0), 1) * 0.25;
      scoreComponents += 0.25;
    }
    if (avgDayPlusOneReturn != null) {
      // Normalize: -5% → 0, +5% → 1
      score += Math.min(Math.max((avgDayPlusOneReturn + 5) / 10, 0), 1) * 0.20;
      scoreComponents += 0.20;
    }
    if (recommendationMean != null) {
      // Invert: 1 (strong buy) → 1.0, 5 (strong sell) → 0.0
      score += ((5 - recommendationMean) / 4) * 0.25;
      scoreComponents += 0.25;
    }
    // Re-normalize to available components so partial data isn't penalized
    const compositeScore = scoreComponents > 0 ? Number((score / scoreComponents).toFixed(3)) : null;

    return {
      ticker: stock.yahoo.replace(/\.ST$/i, ""),
      yahooTicker: stock.yahoo,
      display: stock.display,
      market: stock.market,
      earningsDate: utcCalendarDate(stock.earningsTimestamp),
      earningsInDays: stock.earningsInDays,
      livePrice: stock.livePrice,
      changePct: stock.changePct,
      nextEpsEstimate,
      beatRate,
      avgSurprisePct,
      avgDayPlusOneReturn,
      revisionUpCount: revUp,
      revisionDownCount: revDown,
      recommendationKey,
      recommendationMean,
      numberOfAnalystOpinions,
      targetMeanPrice,
      targetLowPrice,
      targetHighPrice,
      upsidePct,
      compositeScore,
      historicalEarnings: historicalEarnings.slice(0, 4), // last 4 quarters
    };
  });

  // Sort: upcoming first by days, but within same urgency band sort by compositeScore desc
  const sorted = stocks.sort((a, b) => {
    const dA = a.earningsInDays ?? 99;
    const dB = b.earningsInDays ?? 99;
    // Past reports last
    if (dA < 0 && dB >= 0) return 1;
    if (dB < 0 && dA >= 0) return -1;
    if (dA < 0 && dB < 0) return dB - dA; // most recent first
    // Upcoming: sort by score within same day bucket
    const sameDayBucket = dA === dB;
    if (sameDayBucket || Math.abs(dA - dB) <= 2) {
      return (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
    }
    return dA - dB;
  });

  const payload = { stocks: sorted, generatedAt: new Date().toISOString() };
  cache = { data: payload, expiresAt: Date.now() + CACHE_TTL_MS };
  res.json(payload);
});

export default router;
