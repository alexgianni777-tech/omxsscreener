import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";
import { isE2ETestMode } from "../lib/e2eTestSafety";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

/** How many calendar days from today until `ts` (yahoo-finance2 returns a Date). Negative = past. */
function daysUntil(ts: Date | number | undefined | null): number | null {
  if (ts == null) return null;
  const ms = ts instanceof Date ? ts.getTime() : ts * 1000;
  if (!ms || isNaN(ms)) return null;
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  return Math.round((ms - todayUtc.getTime()) / 86_400_000);
}

// GET /screener/quotes?tickers=SSAB,Getinge,SEB
router.get("/screener/quotes", async (req, res): Promise<void> => {
  const tickersParam = req.query.tickers;
  if (!tickersParam || typeof tickersParam !== "string") {
    res.status(400).json({ error: "tickers query parameter is required (comma-separated)" });
    return;
  }

  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (tickers.length === 0) {
    res.json([]);
    return;
  }

  const fetchedAt = new Date().toISOString();

  if (isE2ETestMode()) {
    res.json(tickers.map((ticker) => ({
      ticker,
      yahooTicker: resolveYahooTicker(ticker),
      livePrice: null,
      change: null,
      changePct: null,
      marketState: null,
      asOf: null,
      fetchedAt: null,
      earningsDate: null,
      earningsInDays: null,
      error: "DEMO: real quote lookup disabled in isolated E2E_TEST mode.",
    })));
    return;
  }

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      const yahooTicker = resolveYahooTicker(ticker);
      try {
        const quote = await yf.quote(yahooTicker);
        const earningsTs: Date | null = (quote as any).earningsTimestamp ?? null;
        const earningsInDays = daysUntil(earningsTs);
        const earningsDate =
          earningsTs instanceof Date
            ? earningsTs.toISOString().slice(0, 10)
            : null;
        // regularMarketTime is when Yahoo's underlying price was last updated —
        // this can lag far behind `fetchedAt` outside market hours or on stale feeds.
        const marketTime: Date | null = (quote as any).regularMarketTime ?? null;
        const asOf = marketTime instanceof Date ? marketTime.toISOString() : null;
        return {
          ticker,
          yahooTicker,
          livePrice: quote.regularMarketPrice ?? null,
          change: quote.regularMarketChange ?? null,
          changePct: quote.regularMarketChangePercent ?? null,
          marketState: quote.marketState ?? null,
          asOf,
          fetchedAt,
          earningsDate,
          earningsInDays,
          error: null,
        };
      } catch {
        return {
          ticker,
          yahooTicker,
          livePrice: null,
          change: null,
          changePct: null,
          marketState: null,
          asOf: null,
          fetchedAt,
          earningsDate: null,
          earningsInDays: null,
          error: `Could not fetch quote for ${yahooTicker}`,
        };
      }
    })
  );

  res.json(results);
});

export default router;
