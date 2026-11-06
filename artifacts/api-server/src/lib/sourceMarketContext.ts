import type { SourceMarketContext } from "@workspace/api-zod";

const object = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Receipt-owned evidence only. Never reconstruct an older source from session scalars. */
export function sourceMarketContext(input: unknown, source: string): SourceMarketContext | undefined {
  const body = object(input);
  if (!body) return undefined;
  if (source === "telegram" || source === "manual") {
    const weather = object(body.marketWeather);
    return weather ? { SE: { dataAsOf: typeof body.dataAsOf === "string" ? body.dataAsOf : null, weather: { ...weather } } } : undefined;
  }
  if (source !== "edgeai") return undefined;
  const markets = object(body.markets);
  const rootTrend = object(body.marketTrendV2);
  const result: SourceMarketContext = {};
  for (const market of ["SE", "US"] as const) {
    const data = object(markets?.[market]);
    if (!data) continue;
    const index = object(data.indexSnapshot);
    const trend = object(data.marketTrendV2) ?? object(rootTrend?.[market]);
    result[market] = {
      dataAsOf: typeof data.dataAsOf === "string" ? data.dataAsOf : null,
      ...(index ? { indexSnapshot: { ...index } } : {}),
      ...(trend ? { marketTrendV2: { ...trend } } : {}),
    };
  }
  return result;
}
