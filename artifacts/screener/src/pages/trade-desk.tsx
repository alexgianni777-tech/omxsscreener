import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, ArrowDownToLine, RefreshCw } from "lucide-react";
import {
  getGetQuotesQueryKey,
  getGetSessionQueryKey,
  getListSessionsQueryKey,
  useGetQuotes,
  useGetSession,
  useListSessions,
  type Candidate,
  type QuoteResult,
} from "@workspace/api-client-react";
import { d1Freshness, previousMarketDay, signalSessionDate } from "@workspace/market-calendar";
import { ResearchCard, type ResearchSignal } from "../components/ResearchCard";
import { quoteLabels, quoteRequestTicker, researchQuoteForMarket } from "../lib/researchQuote";
import type { DailyPick } from "../lib/dailyCandidates";
import { candidateReceipt } from "../lib/marketRadarModel";
import { trendAlignment } from "../lib/sourceMarketEvidence";
import { activeOmxs30Candidate } from "../lib/omxs30ActiveView";

function price(value: number) {
  return Number.isFinite(value) ? value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "ej verifierat";
}
function rr(value: number) {
  return Number.isFinite(value) ? value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "ej verifierat";
}

function formatStamp(value?: string | null) {
  if (!value) return "ej registrerad";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }) : value;
}

function OriginalPlan({ candidate }: { candidate: Candidate }) {
  return <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" data-testid="trade-original-plan">
    <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Original signal</p><p className="mt-1 font-mono text-sm">{candidate.signalDate ?? "datum okänt"}</p></div>
    <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Planentry</p><p className="mt-1 font-mono text-sm">{price(candidate.entryPrice)}</p></div>
    <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Initial stop</p><p className="mt-1 font-mono text-sm">{price(candidate.stopPrice)}</p></div>
    <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Target / R:R</p><p className="mt-1 font-mono text-sm">{price(candidate.targetPrice)} / {rr(candidate.rr)}</p></div>
    <p className="sm:col-span-4 border-t border-border pt-3 text-xs text-muted-foreground">
      Marknadsdag {candidate.dataQuality?.dataAsOf ?? "ej verifierad"} · volymdatum {candidate.volumeAsOf ?? "ej verifierat"} ·
      {" "}källa {candidate.signalSource ?? "okänd"} · session {candidate.sessionId}. Originalplanen ändras inte av en quote.
    </p>
  </div>;
}

export function TradeDesk() {
  const [location] = useLocation();
  const sessions = useListSessions({ query: { queryKey: getListSessionsQueryKey() } });
  const latestId = sessions.data?.[0]?.id ?? 0;
  const search = new URLSearchParams(window.location.search);
  const requestedSession = Number(search.get("session"));
  const activeSessionId = Number.isFinite(requestedSession) && requestedSession > 0 ? requestedSession : latestId;
  const detail = useGetSession(activeSessionId, { query: { enabled: activeSessionId > 0, queryKey: getGetSessionQueryKey(activeSessionId) } });
  const storedCandidates = detail.data?.candidates ?? [];
  const candidates = detail.data
    ? storedCandidates.filter(candidate => activeOmxs30Candidate({
        ticker: candidate.ticker, market: candidate.market, sessionDate: detail.data!.date,
      }))
    : [];
  const queryId = Number(search.get("candidate"));
  const [selectedId, setSelectedId] = useState<number | null>(Number.isFinite(queryId) && queryId > 0 ? queryId : null);
  const selected = selectedId == null ? candidates[0] : candidates.find(c => c.id === selectedId);
  const market = selected?.market === "SE" ? selected.market : null;
  const sourceReports = detail.data?.sourceReports ?? [];
  const receipt = selected ? candidateReceipt(selected, sourceReports) : null;
  const marketDataDate = selected
    ? selected.dataQuality?.dataAsOf ?? (receipt && market ? receipt.dataDates?.[market] ?? null : null)
    : null;
  const sessionDate = market ? signalSessionDate(new Date(), market) : null;
  const freshness = market && sessionDate ? d1Freshness(marketDataDate, sessionDate, market).status : "UNKNOWN";
  const expectedDataDate = market && sessionDate ? previousMarketDay(sessionDate, market) : null;
  const params = useMemo(() => ({ tickers: selected && market ? quoteRequestTicker(selected.ticker, market) : "" }), [selected?.id, selected?.ticker, market]);
  const quoteQuery = useGetQuotes(params, { query: { enabled: false, retry: false, queryKey: getGetQuotesQueryKey(params) } });
  const quoteMap = useMemo(() => {
    const map: Record<string, QuoteResult> = {};
    quoteQuery.data?.forEach(quote => { map[quote.ticker] = quote; });
    return map;
  }, [quoteQuery.data]);

  const pick: (DailyPick & { decision?: Candidate["decision"] }) | null = selected && market ? {
    candidateId: selected.id, ticker: selected.ticker, market, direction: selected.direction, rank: selected.rank,
    source: selected.signalSource ?? "okänd", signalDate: selected.signalDate, category: selected.category,
    entryPrice: selected.entryPrice, stopPrice: selected.stopPrice, targetPrice: selected.targetPrice, rr: selected.rr,
    dataQuality: selected.dataQuality ?? null, decision: selected.decision,
  } : null;

  const requestQuote = () => {
    if (selected && market) void quoteQuery.refetch();
  };

  return <section className="space-y-5" data-testid="workspace-trade-desk" aria-busy={sessions.isLoading || detail.isLoading}>
    <header>
      <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-primary">AGIC / Manual review</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Trade Desk</h1>
      <p className="mt-1 text-sm text-muted-foreground">Granska ursprunglig plan, separat quote-evidens och manuella kontrollperspektiv.</p>
    </header>
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-950 dark:text-amber-200" data-testid="trade-no-orders">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p><strong>Ingen orderfunktion.</strong> Checklistan och eventuell arkivering är endast manuell dokumentation. De skapar inte READY-status, ordergodkännande eller mäklarinstruktion.</p>
    </div>

    {sessions.isLoading && <div className="h-16 animate-pulse rounded-xl bg-muted" data-testid="trade-session-loading" />}
    {sessions.isError && <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
      Sessioner kunde inte läsas. <button onClick={() => sessions.refetch()} className="underline" data-testid="button-trade-retry">Försök igen</button>
    </div>}
    {latestId > 0 && detail.isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted" data-testid="trade-detail-loading" />}
    {detail.isError && <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm" data-testid="trade-detail-error">
      Senaste sessionsdetaljer kunde inte hämtas. <button onClick={() => detail.refetch()} className="underline" data-testid="button-trade-detail-retry">Försök igen</button>
    </div>}
    {detail.data && candidates.length === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="trade-empty">
      <h2 className="font-semibold">Ingen kandidat i aktuell session</h2><p className="mt-1 text-sm text-muted-foreground">Trade Desk använder bara befintliga sessionsdata.</p>
    </div>}
    {detail.data && selectedId != null && !selected && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm" data-testid="trade-candidate-missing">
      Kandidaten finns inte i den aktiva OMXS30-listan för vald session. Ingen annan signal väljs automatiskt.
      {storedCandidates.some(candidate => candidate.id === selectedId) && <> Den bevarade posten är äldre eller utanför OMXS30 och visas endast i <Link href={`/sessions/${activeSessionId}`} className="underline">sessionsarkivet</Link>.</>}
    </div>}
    {detail.data && activeSessionId !== latestId && <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground" data-testid="trade-historical-session">
      Historisk session {detail.data.date} · #{detail.data.id}. Originalplanen visas som historisk bevakning, inte som aktiv entry.
    </p>}
    {selected && detail.data && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block text-xs font-medium">Välj aktiv OMXS30-kandidat
          <select value={selected.id} onChange={event => setSelectedId(Number(event.target.value))}
            className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm" data-testid="select-trade-candidate">
            {candidates.map(c => <option key={c.id} value={c.id}>{c.ticker} · {c.market ?? "marknad okänd"} · {c.direction} · {c.signalDate ?? "datum okänt"}</option>)}
          </select>
        </label>
        <button type="button" onClick={requestQuote} disabled={!market || quoteQuery.isFetching}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-trade-fetch-quote">
          <RefreshCw className={`h-3.5 w-3.5 ${quoteQuery.isFetching ? "animate-spin" : ""}`} />
          {quoteQuery.isFetching ? "Hämtar quote…" : "Hämta quote manuellt"}
        </button>
      </div>
      <OriginalPlan candidate={selected} />
      <div className="rounded-xl border border-border bg-card p-4" data-testid="trade-quote-evidence">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Quote-evidens · separat från planen</h2>
            <p className="mt-1 text-xs text-muted-foreground">Endast hämtning efter knapptryck. Visad tid och källmärkning kommer från befintligt quote-svar.</p></div>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{market ?? "MARKNAD EJ VERIFIERAD"}</span>
        </div>
        {quoteQuery.isError && <p role="alert" className="mt-3 text-xs text-destructive" data-testid="trade-quote-error">Quote kunde inte hämtas. Planen är oförändrad. Försök igen eller kontrollera instrumentet manuellt.</p>}
        {!market && <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">Marknad saknas för kandidaten. Ingen quote begärs med antagen marknad.</p>}
        {market && !quoteQuery.data?.length && !quoteQuery.isFetching && <p className="mt-3 text-xs text-muted-foreground" data-testid="trade-quote-empty">Ingen quote hämtad i denna visning. As-of, källa och aktuell kurs är ej verifierade.</p>}
        {quoteQuery.data?.map((quote, i) => <div key={`${quote.ticker}-${i}`} className="mt-3 grid gap-2 border-t border-border pt-3 text-xs sm:grid-cols-4" data-testid={`trade-quote-result-${i}`}>
          <div><p className="text-muted-foreground">Instrument</p><p className="mt-1 font-mono">{quote.ticker} · {quote.yahooTicker ?? "Yahoo-symbol saknas"}</p></div>
          <div><p className="text-muted-foreground">Pris · verifiering</p><p className="mt-1 font-mono">{quoteLabels(researchQuoteForMarket(market ?? "", quote))?.price ?? "saknas"}</p></div>
          <div><p className="text-muted-foreground">Marknad / förändring</p><p className="mt-1">
            {quote.marketState ?? "okänd"} · {typeof quote.changePct === "number" && Number.isFinite(quote.changePct)
              ? `${quote.changePct.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
              : "ej verifierad"}
          </p></div>
          <div><p className="text-muted-foreground">Källtid · källa</p><p className="mt-1">{quoteLabels(researchQuoteForMarket(market ?? "", quote))?.asOf ?? "Tidpunkt ej verifierad"} · {quoteLabels(researchQuoteForMarket(market ?? "", quote))?.source}</p></div>
          <p className="sm:col-span-4 text-muted-foreground">Status: {quoteLabels(researchQuoteForMarket(market ?? "", quote))?.status} · hämtad {formatStamp(quote.fetchedAt)}</p>
          {quote.error && <p className="sm:col-span-4 text-amber-800 dark:text-amber-300">Ej verifierad: {quote.error}</p>}
          {!quote.asOf && <p className="sm:col-span-4 text-amber-800 dark:text-amber-300">Källtid saknas; quote är inte tidsverifierad.</p>}
        </div>)}
      </div>

      {pick ? <ul className="list-none"><ResearchCard pick={pick} signal={selected as unknown as ResearchSignal} reports={sourceReports} boardReviewOpen
        dataDate={marketDataDate} quote={quoteMap[params.tickers]}
        advisory={trendAlignment(sourceReports, market ?? "", selected.direction, marketDataDate)}
        dataDateStatus={freshness} expectedDataDate={expectedDataDate} stale={freshness === "STALE"}
        warnings={selected.importWarning ? [selected.importWarning] : []} /></ul> :
        <div className="rounded-xl border border-border bg-card p-4 text-sm" data-testid="trade-unknown-market-plan">
          <h2 className="font-semibold">{selected.ticker} · {selected.direction}</h2>
          <p className="mt-2 text-xs text-muted-foreground">Originalplan {selected.entryPrice} / stop {selected.stopPrice} / target {selected.targetPrice} · marknad ej angiven. Fullständig marktolkning saknas.</p>
        </div>}

      <div className="rounded-xl border border-border bg-card p-4" data-testid="trade-manual-reviews">
        <div className="flex items-center gap-2"><ArrowDownToLine className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Manuell rapport-, korrelations- och riskgranskning</h2></div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          De fem perspektiven och manuellt utlåtande finns i protokollet nedan. Kontrollera rapportdatum, korrelation, instrumentvillkor och kostnader själv.
          Arkivering exporterar en lokal textfil; den lagrar inte hemligheter och skapar inget godkännande.
        </p>
      </div>
    </>}
    {!latestId && !sessions.isLoading && !sessions.isError && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="trade-no-sessions">Ingen befintlig session att granska.</div>}
    <span className="sr-only">{location}</span>
  </section>;
}
