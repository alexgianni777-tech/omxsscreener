import { fetchCompletedVolumeMultiplier } from "./completedVolume";
import { resolveYahooTicker } from "./omxs30TickerMap";
import { logger } from "./logger";

export type CompletedVolumeRequest = {
  ticker: string;
  market: "SE" | "US";
  asOfDate: string;
};

export const completedVolumeKey = ({ ticker, market, asOfDate }: CompletedVolumeRequest): string =>
  `${market}:${ticker}:${asOfDate}`;

/** Limit Yahoo history calls and never substitute a current quote for a missing daily bar. */
export async function fetchCompletedVolumeBatch(
  yf: Parameters<typeof fetchCompletedVolumeMultiplier>[0],
  requests: CompletedVolumeRequest[],
): Promise<Map<string, { multiplier: number; asOf: string }>> {
  const unique = [...new Map(requests.map((request) => [completedVolumeKey(request), request])).values()];
  const results = new Map<string, { multiplier: number; asOf: string }>();
  for (let offset = 0; offset < unique.length; offset += 8) {
    await Promise.all(unique.slice(offset, offset + 8).map(async (request) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(request.asOfDate)) {
        logger.warn({ ticker: request.ticker, market: request.market }, "Volume source date missing");
        return;
      }
      try {
        const result = await fetchCompletedVolumeMultiplier(
          yf,
          resolveYahooTicker(request.ticker),
          request.asOfDate,
          request.market,
        );
        if (result) results.set(completedVolumeKey(request), result);
        else logger.warn({ ...request }, "Completed Yahoo daily volume unavailable");
      } catch (err: any) {
        logger.warn({ ...request, err: err.message }, "Completed Yahoo daily volume fetch failed");
      }
    }));
  }
  return results;
}