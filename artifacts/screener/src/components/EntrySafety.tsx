import React from "react";
import type { EntryPlan, EntryQuote } from "../lib/liveEntryGuard";
import { actualQuoteAge, chaseWarnings } from "../lib/entrySafety";
export function EntrySafety({ plan, quote, now = Date.now() }: { plan: EntryPlan; quote?: EntryQuote | null; now?: number }) {
  const safety = chaseWarnings(plan, quote, now), minutes = actualQuoteAge(quote, now);
  return <div className="mt-2 rounded border border-border p-2 text-xs break-words" data-testid="chase-guard">
    <p>Kursålder från faktisk asOf: {minutes == null ? "okänd" : `${minutes} min`} · Chase guard (endast varning)</p>
    {safety.warnings.map(w => <p key={w} role="status" className="mt-1 text-amber-700 dark:text-amber-400">{w}</p>)}
    {!safety.warnings.length && <p className="text-muted-foreground">Ingen chase-varning i tillgänglig kursdata; inte ett köpbesked.</p>}
    <p className="mt-1 text-muted-foreground">Originalförslag och screeningstatus bevaras. Kontrollera aktuell Avanza-kurs, kurstid och rapportkälla manuellt.</p>
  </div>;
}
