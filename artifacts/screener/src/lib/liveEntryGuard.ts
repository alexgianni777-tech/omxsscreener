/** Display-only policy. Never changes a signal, its plan, ranking or outcomes. */
export const LIVE_ENTRY_MAX_PRICE_AGE_MS = 5 * 60_000;
export const LIVE_ENTRY_ZONE_R = 0.25;
export const LIVE_ENTRY_MIN_RR = 1.2;

export type EntryPlan = {
  direction: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr?: number | null;
};
export type EntryQuote = {
  livePrice?: number | null;
  asOf?: string | null;
  marketState?: string | null;
  error?: string | null;
};
export type EntryStatus = "READY" | "MISSED_ENTRY" | "PLAN_BROKEN" | "STALE_PRICE" | "UNKNOWN";
export type EntryAssessment = {
  status: EntryStatus;
  reason: string;
  originalRr: number | null;
  liveRr: number | null;
  driftR: number | null;
};

export function assessLiveEntry(plan: EntryPlan, quote?: EntryQuote | null, now = Date.now()): EntryAssessment {
  const { entryPrice: entry, stopPrice: stop, targetPrice: target } = plan;
  const long = plan.direction === "LONG";
  const knownDirection = long || plan.direction === "SHORT";
  const positive = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  const validPlan = knownDirection && [entry, stop, target].every(positive) &&
    (long ? stop < entry && entry < target : target < entry && entry < stop);
  const risk = Math.abs(entry - stop);
  const calculatedRr = validPlan ? Math.abs(target - entry) / risk : null;
  const originalRr = positive(plan.rr) ? plan.rr
    : positive(calculatedRr) ? calculatedRr : null;
  const result: EntryAssessment = { status: "UNKNOWN", reason: "", originalRr, liveRr: null, driftR: null };
  const reject = (status: EntryStatus, reason: string) => ({ ...result, status, reason });
  if (!validPlan) return reject("UNKNOWN", "Originalplanens entry, stop, target eller riktning är ogiltig.");
  if (!quote || quote.error || !positive(quote.livePrice)) {
    return reject("UNKNOWN", "Aktuell kurs saknas eller kurshämtningen misslyckades.");
  }
  const asOf = quote.asOf ? Date.parse(quote.asOf) : NaN;
  if (!Number.isFinite(asOf) || !Number.isFinite(now)) {
    return reject("UNKNOWN", "Kursens faktiska asOf-tid saknas eller är ogiltig; hämtningstid räcker inte.");
  }
  if (asOf > now + 60_000) return reject("UNKNOWN", "Kursens asOf-tid ligger i framtiden.");
  if (!quote.marketState) return reject("UNKNOWN", "Marknadens öppettillstånd är okänt.");
  if (quote.marketState !== "REGULAR") {
    return reject("STALE_PRICE", "Marknaden är stängd eller utanför ordinarie handel; live-entry och aktuellt R/R är okända.");
  }
  if (now - asOf > LIVE_ENTRY_MAX_PRICE_AGE_MS) {
    return reject("STALE_PRICE", "Kursen är äldre än 5 minuter eller fördröjd; hämta en ny kurs.");
  }
  const price = quote.livePrice;
  if (long ? price <= stop : price >= stop) {
    return reject("PLAN_BROKEN", "Originalplanens stop har nåtts eller passerats.");
  }
  if (long ? price >= target : price <= target) {
    return reject("PLAN_BROKEN", "Originalplanens target har nåtts eller passerats; ingen ny entry.");
  }
  const liveRisk = long ? price - stop : stop - price;
  const liveReward = long ? target - price : price - target;
  result.liveRr = liveReward / liveRisk;
  result.driftR = (long ? price - entry : entry - price) / risk;
  if (!Number.isFinite(result.liveRr) || !Number.isFinite(result.driftR)) {
    result.liveRr = null;
    result.driftR = null;
    return reject("UNKNOWN", "Prisnivåerna ger ett ogiltigt aktuellt R/R eller entryavstånd.");
  }
  if (result.driftR > LIVE_ENTRY_ZONE_R) {
    return reject("MISSED_ENTRY", `Kursen har gått ${result.driftR.toFixed(2)}R i signalens riktning; entrygränsen är +0,25R.`);
  }
  if (result.liveRr < LIVE_ENTRY_MIN_RR) {
    return reject("MISSED_ENTRY", `Aktuellt R/R ${result.liveRr.toFixed(2)} är under 1,2; originalplanen ändras inte.`);
  }
  if (result.driftR < -LIVE_ENTRY_ZONE_R) {
    return reject("UNKNOWN", "Kursen ligger före entryzonen (−0,25R); entry är ännu inte bekräftad.");
  }
  return reject("READY", "Färsk kurs inom originalets entryzon och aktuellt R/R minst 1,2. Kontrollera screeningstatus och rapportkalender manuellt.");
}
