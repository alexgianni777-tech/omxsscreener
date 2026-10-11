import React from "react";
import type { EntryQuote, EntryStatus } from "../lib/liveEntryGuard";

/** Captions only: no prices, timestamps or entry decisions are recalculated here. */
export function QuotePresentation({ quote, source, status, showPrice = true }: {
  quote?: EntryQuote | null; source?: string | null; status?: EntryStatus; showPrice?: boolean;
}) {
  const hasTime = !!quote?.asOf && Number.isFinite(Date.parse(quote.asOf));
  const time = hasTime ? new Date(quote!.asOf!).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }) : "tidpunkt ej verifierad";
  return <div className="min-w-0 break-words text-xs leading-relaxed text-muted-foreground" data-testid="quote-provenance">
    {showPrice ? <p><span className="font-medium text-foreground">Marknadskurs</span>{" "}
      <span className="font-mono tabular-nums text-foreground">
        {quote?.livePrice != null && Number.isFinite(quote.livePrice) ? quote.livePrice.toFixed(2) : "okänd"}
      </span> · källa {source || "ej specificerad"}</p> : <p>Kurskälla: {source || "ej specificerad"}</p>}
    <p>asOf {time}{hasTime && " (Stockholm)"} · marknad {quote?.marketState || "okänd"}</p>
    {status && <p>Entrykontroll: {status}{status === "STALE_PRICE" && " · för gammal kurs eller marknad ej öppen"}</p>}
    <p>{!hasTime ? "Kursens tidpunkt saknas/är ogiltig; inte verifierad livekurs. " : "Visad källtidsstämpel är ingen garanti för realtidskurs. "}
      Skild från signalens D−1-/screenerstängning.</p>
    {quote?.error && <p role="status" className="text-amber-700 dark:text-amber-400">{quote.error}</p>}
  </div>;
}
