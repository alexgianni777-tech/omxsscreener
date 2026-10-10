import { assessLiveEntry, LIVE_ENTRY_MIN_RR, type EntryPlan, type EntryQuote } from "./liveEntryGuard";
/** Additional UI warnings only; the existing guard and original plan are untouched. */
export function chaseWarnings(plan: EntryPlan, quote?: EntryQuote | null, now = Date.now()) {
  const a = assessLiveEntry(plan, quote, now);
  const warnings: string[] = [];
  if (a.status === "UNKNOWN" || a.status === "STALE_PRICE" || a.status === "PLAN_BROKEN")
    warnings.push(`Aktuell entry kan inte verifieras: ${a.reason}`);
  if (a.driftR != null && a.driftR > 0) warnings.push("Kursen har passerat planerat entry i signalens riktning — jaga inte kursen utan eget nytt beslut.");
  if (a.liveRr != null && a.liveRr < LIVE_ENTRY_MIN_RR) warnings.push(`Aktuellt R/R ${a.liveRr.toFixed(2)} är under minimigränsen 1,2.`);
  return { assessment: a, warnings };
}
export function calendarAge(date: string | null | undefined, today: string): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const stamp = Date.parse(`${date}T00:00:00Z`), current = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(stamp) && Number.isFinite(current) && new Date(stamp).toISOString().slice(0, 10) === date
    ? Math.round((current - stamp) / 86_400_000) : null;
}
export function actualQuoteAge(quote: EntryQuote | null | undefined, now: number) {
  const stamp = quote?.asOf ? Date.parse(quote.asOf) : NaN;
  return Number.isFinite(stamp) && Number.isFinite(now) && stamp <= now ? Math.floor((now - stamp) / 60_000) : null;
}
