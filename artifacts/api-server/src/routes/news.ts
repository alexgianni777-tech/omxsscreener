import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface NewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: number; // unix timestamp (seconds)
  relatedTickers?: string[];
}

// GET /screener/news?tickers=AAPL,ALFA
// Returns up to 5 news items per ticker (deduped by uuid across all tickers)
router.get("/screener/news", async (req, res): Promise<void> => {
  const tickersParam = req.query.tickers;
  if (!tickersParam || typeof tickersParam !== "string") {
    res.status(400).json({ error: "tickers query param required" });
    return;
  }

  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 26); // guard against too many

  // Fetch news for each ticker in parallel (search gives richer news than quote)
  const seen = new Set<string>();
  const allNews: NewsItem[] = [];

  await Promise.all(
    tickers.map(async (ticker) => {
      const yahooTicker = resolveYahooTicker(ticker);
      try {
        const result = await yf.search(yahooTicker, { newsCount: 5 });
        for (const item of result.news ?? []) {
          if (seen.has(item.uuid)) continue;
          seen.add(item.uuid);
          allNews.push({
            uuid: item.uuid,
            title: item.title,
            publisher: item.publisher,
            link: item.link,
            publishedAt: item.providerPublishTime instanceof Date
              ? Math.floor(item.providerPublishTime.getTime() / 1000)
              : typeof item.providerPublishTime === "number"
                ? item.providerPublishTime
                : 0,
            relatedTickers: item.relatedTickers,
          });
        }
      } catch {
        // Non-fatal — ticker may have no news
      }
    }),
  );

  // Sort by newest first, cap at 20 total
  allNews.sort((a, b) => b.publishedAt - a.publishedAt);

  res.json(allNews.slice(0, 20));
});

export default router;
