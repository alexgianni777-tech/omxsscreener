/**
 * GET /market-intel
 * Returns Fear & Greed index (CNN) and trailing/forward P/E for major indices.
 * All data is free and cached 15 min server-side.
 */
import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

interface MarketIntelData {
  fearGreed: {
    score: number;
    rating: string;
    previousClose: number;
    previousWeek: number;
    previousMonth: number;
  } | null;
  pe: {
    sp500: { trailing: number | null; forward: number | null };
    nasdaq: { trailing: number | null; forward: number | null };
    omxs30: { trailing: number | null; forward: number | null };
  };
  fetchedAt: string;
}

let cache: { data: MarketIntelData; ts: number } | null = null;
const CACHE_MS = 15 * 60_000; // 15 minutes

router.get("/market-intel", async (_req, res): Promise<void> => {
  if (cache && Date.now() - cache.ts < CACHE_MS) {
    res.json(cache.data);
    return;
  }

  const [fgResult, spyResult, qqqResult, omxResult] = await Promise.allSettled([
    fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; market-intel-proxy/1.0)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    }).then((r) => {
      if (!r.ok) throw new Error(`CNN F&G HTTP ${r.status}`);
      return r.json() as Promise<any>;
    }),
    yf.quoteSummary("SPY", { modules: ["summaryDetail"] }),
    yf.quoteSummary("QQQ", { modules: ["summaryDetail"] }),
    yf.quoteSummary("^OMX", { modules: ["summaryDetail"] }),
  ]);

  const fgRaw = fgResult.status === "fulfilled" ? fgResult.value : null;
  const spySummary = spyResult.status === "fulfilled" ? spyResult.value?.summaryDetail : null;
  const qqqSummary = qqqResult.status === "fulfilled" ? qqqResult.value?.summaryDetail : null;
  const omxSummary = omxResult.status === "fulfilled" ? omxResult.value?.summaryDetail : null;

  const data: MarketIntelData = {
    fearGreed: fgRaw?.fear_and_greed
      ? {
          score: Math.round(fgRaw.fear_and_greed.score ?? 0),
          rating: fgRaw.fear_and_greed.rating ?? "unknown",
          previousClose: Math.round(fgRaw.fear_and_greed.previous_close ?? 0),
          previousWeek: Math.round(fgRaw.fear_and_greed.previous_1_week ?? 0),
          previousMonth: Math.round(fgRaw.fear_and_greed.previous_1_month ?? 0),
        }
      : null,
    pe: {
      sp500: {
        trailing: spySummary?.trailingPE ?? null,
        forward: spySummary?.forwardPE ?? null,
      },
      nasdaq: {
        trailing: qqqSummary?.trailingPE ?? null,
        forward: qqqSummary?.forwardPE ?? null,
      },
      omxs30: {
        trailing: omxSummary?.trailingPE ?? null,
        forward: omxSummary?.forwardPE ?? null,
      },
    },
    fetchedAt: new Date().toISOString(),
  };

  cache = { data, ts: Date.now() };
  res.json(data);
});

export default router;
