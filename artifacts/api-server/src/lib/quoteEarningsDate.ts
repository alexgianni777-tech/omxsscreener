import { marketDate, type EquityMarket } from "@workspace/market-calendar";

/** Calendar dates in the instrument's exchange zone, never rounded elapsed hours. */
export function quoteEarningsDate(
  timestamp: Date | number | null | undefined,
  yahooTicker: string,
  now = new Date(),
) {
  const date = timestamp instanceof Date ? timestamp :
    typeof timestamp === "number" ? new Date(timestamp * 1000) : null;
  if (!date || !Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) {
    return { earningsDate: null, earningsInDays: null };
  }
  // Only the supported Swedish and US instruments have a known exchange zone.
  const market: EquityMarket | null = yahooTicker.endsWith(".ST") ? "SE" :
    /^[A-Z][A-Z0-9-]*(?:[.][AB])?$/.test(yahooTicker) ? "US" : null;
  if (!market) return { earningsDate: null, earningsInDays: null };
  const earningsDate = marketDate(date, market);
  const today = marketDate(now, market);
  return { earningsDate,
    earningsInDays: (Date.parse(`${earningsDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 };
}
