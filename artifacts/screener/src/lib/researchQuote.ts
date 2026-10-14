import type { QuoteResult } from "@workspace/api-client-react";
import { formatPrice } from "./presentationNumbers";

/** Labels for a manually fetched quote. Never derived from the D-1 plan. */
export function quoteLabels(quote: QuoteResult | null | undefined) {
  if (!quote) return null;
  const t = quote.asOf ? Date.parse(quote.asOf) : NaN;
  const asOf = Number.isFinite(t)
    ? new Date(t).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + " (Europe/Stockholm)"
    : "Tidpunkt ej verifierad";
  return {
    price: quote.livePrice != null ? formatPrice(quote.livePrice) : "Pris saknas",
    asOf,
    source: `Yahoo Finance · ${quote.yahooTicker || quote.ticker}`,
    status: quote.error ? `Fel: ${quote.error}` : quote.marketState ?? "Marknadsstatus okänd",
  };
}

/** Saved fallback evidence: only the saved selection's own dataDates, never newest reports. */
export function savedDataDate(dataDates: readonly { source: string; signalDate: string | null; dataDate: string | null }[],
  source: string | null | undefined, signalDate: string | null | undefined) {
  return dataDates.find(d => d.source === source && d.signalDate === (signalDate ?? null))?.dataDate ?? null;
}
