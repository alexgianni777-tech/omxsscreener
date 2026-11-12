import type { QuoteResult } from "@workspace/api-client-react";
import { formatPrice } from "./presentationNumbers";
import { LIVE_ENTRY_MAX_PRICE_AGE_MS } from "./liveEntryGuard";

/** Keep exchange identity in request/cache keys and response lookup keys. */
export function quoteRequestTicker(ticker: string, market?: string | null): string {
  return market === "SE" || market === "US" ? `${market}:${ticker.trim()}` : ticker.trim();
}

/** UI safety only: keep the fetched price/mapping intact, but flag a different quote market. */
export function researchQuoteForMarket(market: string, quote: QuoteResult | null | undefined) {
  if (!quote) return quote;
  const yahoo = quote.yahooTicker?.trim().toUpperCase();
  if (market === "US" && (!yahoo || yahoo.endsWith(".ST"))) {
    const warning = `Kurskoppling ej verifierad för USA: ${yahoo || "instrumentsymbol saknas"}. Ingen entrybekräftelse.`;
    return { ...quote, error: [quote.error, warning].filter(Boolean).join(" ") };
  }
  if (market !== "SE") return quote;
  if (!yahoo?.endsWith(".ST")) {
    const warning = yahoo
      ? `Kurskoppling ej verifierad: Yahoo-symbol ${yahoo} saknar Stockholmsmarknad (.ST). Ingen entrybekräftelse.`
      : "Kurskoppling ej verifierad: källans instrumentsymbol saknas. Ingen entrybekräftelse.";
    return { ...quote, error: [quote.error, warning].filter(Boolean).join(" ") };
  }
  return quote;
}

/** Labels for a manually fetched quote. Never derived from the D-1 plan. */
export function quoteLabels(quote: QuoteResult | null | undefined, now = Date.now()) {
  if (!quote) return null;
  const t = quote.asOf ? Date.parse(quote.asOf) : NaN;
  const verifiedTime = typeof quote.asOf === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(quote.asOf) && Number.isFinite(t);
  const age = verifiedTime ? now - t : NaN;
  const recent = Number.isFinite(age) && age >= -60_000 && age <= LIVE_ENTRY_MAX_PRICE_AGE_MS;
  const usable = recent && !quote.error && quote.marketState === "REGULAR" &&
    quote.livePrice != null && Number.isFinite(quote.livePrice) && quote.livePrice > 0;
  const asOf = verifiedTime
    ? new Date(t).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + " (Europe/Stockholm)"
    : "Tidpunkt ej verifierad";
  return {
    price: usable ? formatPrice(quote.livePrice!) : quote.livePrice == null ? "Pris saknas" : "Kurs ej verifierad",
    observedPrice: !usable && !quote.error && quote.livePrice != null && Number.isFinite(quote.livePrice) && quote.livePrice > 0 ? formatPrice(quote.livePrice) : null,
    asOf,
    source: `Yahoo Finance · ${quote.yahooTicker || quote.ticker}`,
    status: quote.error ? `Fel: ${quote.error}` : `${quote.marketState ?? "Marknadsstatus okänd"} · ${
      !verifiedTime ? "kursålder okänd" : age < -60_000 ? "CONFLICT – framtida källtid" : !recent
        ? `STALE – ${Math.max(0, Math.floor(age / 60000))} min gammal`
        : `${Math.max(0, Math.floor(age / 60000))} min gammal`}`,
  };
}

/** Saved fallback evidence: only the saved selection's own dataDates, never newest reports. */
export function savedDataDate(dataDates: readonly { market?: string; source: string; signalDate: string | null; dataDate: string | null }[],
  source: string | null | undefined, signalDate: string | null | undefined, market?: string) {
  const matches = dataDates.filter(d => d.source === source && d.signalDate === (signalDate ?? null));
  if (market) {
    const exact = matches.find(d => d.market === market);
    if (exact) return exact.dataDate;
    // Legacy receipts were SE-first and did not identify the market. Never
    // lend that date to US, or choose between conflicting legacy dates.
    if (market === "SE" && matches.length && matches.every(d => !d.market && d.dataDate === matches[0].dataDate))
      return matches[0].dataDate;
    return null;
  }
  return matches[0]?.dataDate ?? null;
}
