import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";

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
        return {
          ticker,
          yahooTicker,
          livePrice: quote.regularMarketPrice ?? null,
          change: quote.regularMarketChange ?? null,
          changePct: quote.regularMarketChangePercent ?? null,
          marketState: quote.marketState ?? null,
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
