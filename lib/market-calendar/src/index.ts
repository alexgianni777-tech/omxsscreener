/** Cash equity calendars, verified 2026-11-05. No network requests or inferred holidays.
 * Sources: https://www.nasdaq.com/european-market-activity/trading-hours
 * https://www.nyse.com/markets/hours-calendars
 * Half days remain trading days. Unknown years/markets fail closed.
 */
export type EquityMarket = "SE" | "US";

/** An explicit signal-time observation, never a guessed upcoming report. */
export function observedReportDate(signalDate: unknown, days: unknown, knowledge: unknown): string | null {
  if (knowledge !== "SIGNAL_TIME" || !validMarketDate(signalDate) ||
    typeof days !== "number" || !Number.isSafeInteger(days) || days < 0 || days > 366) return null;
  return shifted(signalDate, days);
}

/** Reports today or within five exchange trading days prevent qualification.
 * Date-only inputs are exchange-local days, not elapsed UTC hours.
 */
export function reportWindow(date: unknown, reference: string, market: string) {
  if (!validMarketDate(date) || !validMarketDate(reference) || date < reference ||
    isTradingDay(reference, market) == null || isTradingDay(date, market) == null)
    return { status: "UNKNOWN_REPORT_DATE" as const, tradingDays: null, blocked: true };
  let day = reference, count = 0;
  while (day < date) {
    day = shifted(day, 1);
    if (isTradingDay(day, market)) count++;
  }
  return { status: count <= 5 ? "REPORT_WITHIN_5_TRADING_DAYS" as const : "VERIFIED_REPORT_WINDOW" as const,
    tradingDays: count, blocked: count <= 5 };
}
const CLOSED: Record<EquityMarket, readonly string[]> = {
  SE: [
    "2025-12-24", "2025-12-25", "2025-12-26", "2025-12-31",
    "2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14",
    "2026-06-19", "2026-12-24", "2026-12-25", "2026-12-31",
    "2027-01-01", "2027-01-06", "2027-03-26", "2027-03-29", "2027-05-06",
    "2027-06-25", "2027-12-24", "2027-12-31",
  ],
  US: [
    "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  ],
};
const HALF_DAYS: Record<EquityMarket, readonly string[]> = {
  SE: ["2026-01-05", "2026-04-02", "2026-04-30", "2026-05-13", "2026-10-30",
    "2027-01-05", "2027-03-25", "2027-04-30", "2027-05-05", "2027-11-05"],
  US: ["2026-11-27", "2026-12-24", "2027-11-26"],
};
export function validMarketDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}
export function marketDate(now: Date, market: EquityMarket): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: market === "SE" ? "Europe/Stockholm" : "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** After the cash close the next session's D−1 is today's completed session.
 * This is signal-age logic only, never a live-market/quote approval.
 */
export function signalSessionDate(now: Date, market: EquityMarket): string {
  const date = marketDate(now, market);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: market === "SE" ? "Europe/Stockholm" : "America/New_York",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now).split(":").map(Number);
  const close = HALF_DAYS[market].includes(date) ? 13 * 60 : market === "SE" ? 17 * 60 + 30 : 16 * 60;
  return nextOrCurrentSession(isTradingDay(date, market) && parts[0] * 60 + parts[1] >= close
    ? shifted(date, 1) : date, market) ?? date;
}
export function isTradingDay(date: string, market: string): boolean | null {
  if (!(market === "SE" || market === "US") || !validMarketDate(date) ||
    date < "2025-12-01" || date > "2027-12-31") return null;
  return ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) && !CLOSED[market].includes(date);
}
function shifted(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function previousMarketDay(date: string, market: string): string | null {
  if (isTradingDay(date, market) == null) return null;
  let day = date;
  for (let i = 0; i < 14; i++) {
    day = shifted(day, -1);
    const trading = isTradingDay(day, market);
    if (trading == null) return null;
    if (trading) return day;
  }
  return null;
}
/** A closed calendar day belongs to the next trading session, not a new D−1. */
export function nextOrCurrentSession(date: string, market: string): string | null {
  if (isTradingDay(date, market) == null) return null;
  let day = date;
  for (let i = 0; i < 14; i++, day = shifted(day, 1)) {
    const trading = isTradingDay(day, market);
    if (trading == null) return null;
    if (trading) return day;
  }
  return null;
}
export function acceptedReportDate(date: unknown, reference: string, market: string = "SE"): boolean {
  return validMarketDate(date) && validMarketDate(reference) &&
    isTradingDay(reference, market) != null &&
    (date === reference || date === previousMarketDay(reference, market));
}
export function d1Freshness(dataDate: unknown, reference: string, market: string) {
  const session = nextOrCurrentSession(reference, market);
  const expected = session ? previousMarketDay(session, market) : null;
  const status = !expected || !validMarketDate(dataDate) ? "UNKNOWN"
    : dataDate === expected ? "CURRENT" : dataDate < expected ? "STALE" : "CONFLICT";
  return { status, expected, session } as const;
}
