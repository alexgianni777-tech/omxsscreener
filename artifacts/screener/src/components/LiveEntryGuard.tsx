import React, { useEffect, useReducer } from "react";
import { qualifyResearch, type Qualification, type ResearchEvidence } from "../lib/researchQualification";
import {BOARD_REVIEW_REQUIRED} from "@workspace/market-calendar/research-policy";
import { EntrySafety } from "./EntrySafety";
import { DataFreshness } from "./DataFreshness";
import { QuotePresentation } from "./QuotePresentation";
import { formatRR } from "../lib/presentationNumbers";
import type { CandidateDataQuality } from "@workspace/api-client-react";
import { sourceQualityReasons } from "../lib/sourceQuality";
import { assessLiveEntry, LIVE_ENTRY_MAX_PRICE_AGE_MS, type EntryPlan, type EntryQuote, type EntryStatus } from "../lib/liveEntryGuard";

const STYLES: Record<EntryStatus, string> = {
  READY: "text-success",
  MISSED_ENTRY: "text-amber-700 dark:text-amber-400",
  PLAN_BROKEN: "text-destructive",
  STALE_PRICE: "text-amber-700 dark:text-amber-400",
  UNKNOWN: "text-muted-foreground",
};
export type SignalMetadata = ResearchEvidence & {
  /** Set only from the API's exact, structured candidate quarantine match. */
  sourceConflict?: boolean;
  qualification?: Qualification;
  review?: { status: string; reasons: string[] };
  dataQuality?: CandidateDataQuality | null;
  importWarning?: string | null;
  signalDate?: string | null;
  signalSource?: string | null;
  signalAgeBars?: number | null;
};

export function LiveEntryGuard({ plan, quote, signal, now }: {
  plan: EntryPlan;
  quote?: (EntryQuote & { yahooTicker?: string }) | null;
  signal?: SignalMetadata;
  now?: number;
}) {
  const [, expirePrice] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (now != null || !quote?.asOf) return;
    const remaining = Date.parse(quote.asOf) + LIVE_ENTRY_MAX_PRICE_AGE_MS - Date.now();
    if (!Number.isFinite(remaining) || remaining < 0 || remaining > LIVE_ENTRY_MAX_PRICE_AGE_MS + 60_000) return;
    // One local expiry, not network polling. A manual quote cannot stay READY indefinitely.
    const timer = setTimeout(expirePrice, remaining + 1);
    return () => clearTimeout(timer);
  }, [quote?.asOf, now]);
  const qualityWarning = sourceQualityReasons(signal?.signalSource, signal?.dataQuality)[0];
  const qualification = signal?.qualification ?? qualifyResearch({ ...signal, ...plan });
  const warning = (signal?.sourceConflict ? signal.importWarning || "Källkonflikt – ingen ny entry." : null) ||
    (signal?.review && signal.review.status !== "APPROVED"
    ? signal.review.reasons.join(" ") || "BLOCKERAD – signalens datakontroll är underkänd." : null) ||
    qualityWarning || signal?.importWarning || (qualification.status !== "QUALIFIED"
      ? qualification.reasons[0] ?? `${qualification.status} – ingen kvalificerad entry.` : null);
  const priceAssessment = warning
    ? { ...assessLiveEntry(plan, null, now), status: "UNKNOWN" as const, reason: warning }
    : assessLiveEntry(plan, quote, now);
  const assessment=priceAssessment.status==="READY"
    ? {...priceAssessment,status:"UNKNOWN" as const,reason:BOARD_REVIEW_REQUIRED+" – prisvillkor är inte ordergodkännande."}
    : priceAssessment;
  const age = signal?.signalAgeBars;
  const hasPrice = quote?.livePrice != null && Number.isFinite(quote.livePrice) && quote.livePrice > 0;
  const hasTime = !!quote?.asOf && Number.isFinite(Date.parse(quote.asOf));
  const statusText = {
    READY: "READY · prisvillkor uppfyllda, inte köpbesked",
    MISSED_ENTRY: "Entry passerad – ingen entrybekräftelse",
    PLAN_BROKEN: "Plan bruten – ingen entrybekräftelse",
    STALE_PRICE: "För gammal kurs eller stängd marknad – ingen entrybekräftelse",
    UNKNOWN: signal?.sourceConflict ? "CONFLICT – BLOCKERAD, ingen ny entry"
      : !hasPrice ? "Livekurs saknas – ingen entrybekräftelse"
      : warning ? "Signaldata behöver kontrolleras – ingen entrybekräftelse"
      : "Livekurs ej verifierad – ingen entrybekräftelse",
  }[assessment.status];
  return (
    <div data-testid="live-entry-guard" data-entry-status={assessment.status}
      className="mt-2 min-w-0 border-t border-border pt-2 text-xs leading-relaxed whitespace-normal break-words">
      <p role="status" className={`font-medium ${signal?.sourceConflict ? "text-destructive" : STYLES[assessment.status]}`}>
        {statusText}
      </p>
      <p className="text-muted-foreground">{BOARD_REVIEW_REQUIRED} · underliggande aktie, manuellt fempartsprotokoll krävs.</p>
      {hasPrice && !hasTime && <p className="text-muted-foreground">Tidpunkt ej verifierad</p>}
      {assessment.liveRr != null && <p className="font-mono tabular-nums">Aktuellt R/R: {formatRR(assessment.liveRr)}</p>}
      {assessment.status === "READY" && assessment.driftR != null && assessment.driftR > 0 &&
        <p className="text-amber-700 dark:text-amber-400">Kursen har passerat entry – jaga inte kursen utan eget nytt beslut.</p>}
      <details className="mt-1">
        <summary className="cursor-pointer text-muted-foreground">Visa detaljer</summary>
        <div className="mt-2 space-y-2">
      <p><strong>Live Entry Guard · {assessment.status}</strong> · {assessment.reason}</p>
      {assessment.status !== "READY" && <p>Ingen genomförbar live-entry.</p>}
      <p className="font-mono tabular-nums">R/R original: {formatRR(assessment.originalRr)} · aktuellt: {formatRR(assessment.liveRr)}</p>
      <QuotePresentation quote={quote} source={quote?.yahooTicker ? "Yahoo Finance" : null} />
      <p className="mt-1 text-muted-foreground">
        Rapport {signal?.signalDate || "okänt datum"} · Källa {signal?.signalSource || "okänd"}
        {" · Setupålder "}{age != null && Number.isFinite(age) && age >= 0 ? `${age} bars vid rapporten` : "okänd"}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        TRADEABLE = screeningstatus, inte live-entrybesked. Prisvillkor räcker inte: manuell styrelsegranskning och verifierat underlag krävs. Ingen automatisk order godkänns.
        {" "}Regel: öppen marknad, asOf högst 5 min, entry ±0,25R (R = original entry–stop), aktuellt R/R ≥1,2.
      </p>
      <DataFreshness reportDate={signal?.signalDate} source={signal?.signalSource}
        manual={signal?.signalSource === "manual"} />
      <EntrySafety plan={plan} quote={null} now={now} />
        </div>
      </details>
    </div>
  );
}
