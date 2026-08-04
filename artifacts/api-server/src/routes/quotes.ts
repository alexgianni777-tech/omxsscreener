import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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
        return {
          ticker,
          yahooTicker,
          livePrice: quote.regularMarketPrice ?? null,
          change: quote.regularMarketChange ?? null,
          changePct: quote.regularMarketChangePercent ?? null,
          marketState: quote.marketState ?? null,
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
          error: `Could not fetch quote for ${yahooTicker}`,
        };
      }
    })
  );

  res.json(results);
});

export default router;
