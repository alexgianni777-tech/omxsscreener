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

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

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
  const ms = dt instanceof Date ? dt.getTime() : new Date(dt).getTime();
  if (isNaN(ms)) return null;
  const todayMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  return Math.round((ms - todayMs) / 86_400_000);
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
  // 1. Get US tickers from latest EdgeAI session
  const omxsYahooSet = new Set(OMXS30_TICKERS.map((t) => t.yahoo));
  let usTickers: { yahoo: string; display: string }[] = [];
  try {
    const [latestSession] = await db
      .select({ id: screenerSessionsTable.id })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.source as any, "edgeai"))
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

  const universe: { yahoo: string; display: string; market: "SE" | "US" }[] = [
    ...OMXS30_TICKERS.map((t) => ({ ...t, market: "SE" as const })),
    ...usTickers.map((t) => ({ ...t, market: "US" as const })),
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

  // 4. Fetch quoteSummary (earningsHistory + earningsTrend) — concurrency 4
  const summaryResults = await withConcurrency(
    relevant.map((stock) => async () => {
      const s = await yf.quoteSummary(stock.yahoo, {
        modules: ["earningsHistory", "earningsTrend"],
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
      const estimate = h.epsEstimate?.raw ?? null;
      const actual = h.epsActual?.raw ?? null;
      const surprisePct = h.surprisePercent?.raw != null
        ? Number((h.surprisePercent.raw * 100).toFixed(2))
        : estimate != null && actual != null && estimate !== 0
        ? Number((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(2))
        : null;
      const quarterDate = h.quarter?.raw
        ? new Date(h.quarter.raw * 1000)
        : null;
      const dayPlusOneReturn = quarterDate
        ? computeDayPlusOneReturn(history, quarterDate)
        : null;
      return {
        date: quarterDate?.toISOString().slice(0, 10) ?? h.period ?? "?",
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
    const revUp = currentTrend?.epsRevisions?.upLast30days?.raw ?? 0;
    const revDown = currentTrend?.epsRevisions?.downLast30days?.raw ?? 0;
    const nextEpsEstimate = currentTrend?.earningsEstimate?.avg?.raw ?? null;

    return {
      ticker: stock.yahoo.replace(/\.ST$/i, ""),
      yahooTicker: stock.yahoo,
      display: stock.display,
      market: stock.market,
      earningsDate: stock.earningsTimestamp instanceof Date
        ? stock.earningsTimestamp.toISOString().slice(0, 10)
        : null,
      earningsInDays: stock.earningsInDays,
      livePrice: stock.livePrice,
      changePct: stock.changePct,
      nextEpsEstimate,
      beatRate,
      avgSurprisePct,
      avgDayPlusOneReturn,
      revisionUpCount: revUp,
      revisionDownCount: revDown,
      historicalEarnings: historicalEarnings.slice(0, 4), // last 4 quarters
    };
  });

  res.json({ stocks, generatedAt: new Date().toISOString() });
});

export default router;
