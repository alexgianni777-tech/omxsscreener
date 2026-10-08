import React from "react";
import { assessLiveEntry, type EntryPlan, type EntryQuote, type EntryStatus } from "../lib/liveEntryGuard";

const STYLES: Record<EntryStatus, string> = {
  READY: "border-success/30 bg-success/5 text-success",
  MISSED_ENTRY: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  PLAN_BROKEN: "border-destructive/30 bg-destructive/5 text-destructive",
  STALE_PRICE: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  UNKNOWN: "border-border bg-muted/30 text-muted-foreground",
};
export type SignalMetadata = {
  signalDate?: string | null;
  signalSource?: string | null;
  signalAgeBars?: number | null;
};

function quoteTime(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })
    : "okänd";
}

export function LiveEntryGuard({ plan, quote, signal, now }: {
  plan: EntryPlan;
  quote?: EntryQuote | null;
  signal?: SignalMetadata;
  now?: number;
}) {
  const assessment = assessLiveEntry(plan, quote, now);
  const age = signal?.signalAgeBars;
  return (
    <div data-testid="live-entry-guard" data-entry-status={assessment.status}
      className={`mt-2 rounded-md border p-2 text-xs whitespace-normal ${STYLES[assessment.status]}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong>Live Entry Guard · {assessment.status}</strong>
        <span className="font-mono">
          R/R original: {assessment.originalRr?.toFixed(2) ?? "okänt"} · aktuellt: {assessment.liveRr?.toFixed(2) ?? "okänt"}
        </span>
      </p>
      <p className="mt-1">{assessment.reason}</p>
      <p className="mt-1 text-muted-foreground">
        Kurs {quote?.livePrice != null && Number.isFinite(quote.livePrice) ? quote.livePrice.toFixed(2) : "okänd"}
        {" · asOf "}{quoteTime(quote?.asOf)} (Stockholm)
        {" · Marknad "}{quote?.marketState || "okänd"}
      </p>
      <p className="mt-1 text-muted-foreground">
        Rapport {signal?.signalDate || "okänt datum"} · Källa {signal?.signalSource || "okänd"}
        {" · Setupålder "}{age != null && Number.isFinite(age) && age >= 0 ? `${age} bars vid rapporten` : "okänd"}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        TRADEABLE = screeningstatus, inte live-entrybesked. READY avser bara prisvillkoren, inte en order.
        {" "}Regel: öppen marknad, asOf högst 5 min, entry ±0,25R (R = original entry–stop), aktuellt R/R ≥1,2.
      </p>
    </div>
  );
}
