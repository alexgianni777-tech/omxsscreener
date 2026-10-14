import React from "react";
import { Link } from "wouter";
import {
  useGetLastValidTop3, getGetLastValidTop3QueryKey, useGetSession, getGetSessionQueryKey,
  useGetQuotes, getGetQuotesQueryKey, useListSessions, type QuoteResult, type SavedTop3Display, type SessionSourceReport,
} from "@workspace/api-client-react";
import { ResearchCard, type ResearchSignal } from "./ResearchCard";
import { swedishDailyPicks, previousWeekday, isolatedDailyPick, dailySymbol, type DailyPick } from "../lib/dailyCandidates";
import { stockholmToday } from "../lib/persistentTop3Display";
import { savedDataDate } from "../lib/researchQuote";

export function researchPicks(selection: SavedTop3Display): DailyPick[] {
  return selection.revision.picks.map(p => ({ ...p, market: p.market ?? "", source: p.source ?? "okänd", signalDate: p.signalDate ?? null }));
}

export function SwedishResearchContent({ selection, signals = [], reports = [], quotes = {}, today, onRefresh, refreshing = false, quoteError = false }: {
  selection: SavedTop3Display; signals?: readonly ResearchSignal[]; reports?: readonly SessionSourceReport[]; quotes?: Record<string, QuoteResult>;
  today: string; onRefresh?: () => void; refreshing?: boolean; quoteError?: boolean;
}) {
  const groups = swedishDailyPicks(researchPicks(selection));
  const stale = selection.date !== today || selection.dataDates.some(d => !d.dataDate || d.dataDate !== previousWeekday(today));
  const official = selection.kind === "OFFICIAL";
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Svensk research · Top 3</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono" data-testid="text-research-date">Session {selection.date}</span>
          <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
            {official ? "Officiellt fryst urval" : `Ändringsbar rekommendation v${selection.revision.revision}`}</span>
          {stale && <span data-testid="status-research-stale" className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">STALE</span>}
          <span>Long {groups[0].picks.length}/3 · Short {groups[1].picks.length}/3</span>
        </p>
      </div>
      <button type="button" data-testid="button-refresh-quotes" onClick={onRefresh} disabled={!onRefresh || refreshing}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
        {refreshing ? "Hämtar priser…" : "Uppdatera priser"}</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      Senast giltiga sparade urval behålls tills ett nytt giltigt finns. Underlag från föregående stängning; inte ett köpbesked.
      {stale && " Gammalt eller ej styrkt datadatum: inget nytt köp utan egen liveverifiering."}
    </p>
    {quoteError && <p role="alert" className="mt-2 text-xs text-destructive">Kurshämtningen misslyckades. Planerna är oförändrade; försök igen eller kontrollera Avanza.</p>}
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {groups.map(g => <section key={g.direction} data-testid={`research-${g.direction}`} className="min-w-0">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{HEAD(g.direction)} · {g.picks.length}/3</h3>
        {!g.picks.length && <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">Inga förslag i sparat urval. Inga extra signaler skapas.</p>}
        <ul className="space-y-2">{g.picks.map(p => <ResearchCard key={p.candidateId} pick={p}
          signal={signals.find(c => c.id === p.candidateId && (c.signalDate ?? null) === (p.signalDate ?? null) &&
            c.entryPrice === p.entryPrice && c.stopPrice === p.stopPrice && c.targetPrice === p.targetPrice)}
          dataDate={savedDataDate(selection.dataDates, p.source, p.signalDate)} quote={quotes[p.ticker]}
          warnings={pickWarnings(p, reports, signals as Conflictable[])} />)}</ul>
      </section>)}
    </div>
    <Link href={`/sessions/${selection.sessionId}`} className="mt-3 inline-block text-xs font-medium text-primary hover:underline" data-testid="link-research-session">
      Öppna sessionen för versioner, fryst urval och utfall</Link>
  </>;
}

type Conflictable = ResearchSignal & { ticker?: string; market?: string | null; direction?: string };
/** Reuses existing quarantine helper and DailyCandidates' plan-conflict check; no new rules. */
export function pickWarnings(p: DailyPick, reports: readonly SessionSourceReport[], signals: readonly Conflictable[]) {
  const out: string[] = [];
  const matching = reports.filter(r => r.status !== "FAILED" && r.source === p.source && r.signalDate === p.signalDate);
  const identity = [p.market, p.category, dailySymbol(p.ticker, p.market), p.direction, ...(p.signalDate ? [p.signalDate] : []), p.source].join("|");
  const quarantinedSomewhere = matching.some(r => r.quarantinedIdentities?.includes(identity));
  if (isolatedDailyPick(p, reports)) out.push("Källkonflikt – ingen entrybekräftelse");
  else if (quarantinedSomewhere) out.push("Källkonflikt osäker – rapportversion kan inte kopplas entydigt; ingen entrybekräftelse");
  if (signals.some(c => (c.market ?? "SE") === "SE" && c.ticker && dailySymbol(c.ticker) === dailySymbol(p.ticker) &&
    (c.direction !== p.direction || c.entryPrice !== p.entryPrice || c.stopPrice !== p.stopPrice || c.targetPrice !== p.targetPrice)))
    out.push("Flera planer/riktningar för aktien – jämför innan beslut");
  return out;
}
const HEAD = (d: string) => d === "LONG" ? "Köp / Long" : "Sälj / Short";

/** Shown only when no saved valid selection exists. Existing ranked live selection, unchanged. */
export function PreliminaryResearchContent({ picks, sessionDate, signals = [], quotes = {}, onRefresh, refreshing = false, quoteError = false }: {
  picks: readonly DailyPick[]; sessionDate: string; signals?: readonly ResearchSignal[]; quotes?: Record<string, QuoteResult>;
  onRefresh?: () => void; refreshing?: boolean; quoteError?: boolean;
}) {
  const groups = swedishDailyPicks(picks);
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Svensk research · Top 3</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">Session {sessionDate}</span>
          <span data-testid="status-research-preliminary" className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">PRELIMINÄR</span>
          <span>Long {groups[0].picks.length}/3 · Short {groups[1].picks.length}/3</span>
        </p>
      </div>
      <button type="button" data-testid="button-refresh-quotes" onClick={onRefresh} disabled={!onRefresh || refreshing}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
        {refreshing ? "Hämtar priser…" : "Uppdatera priser"}</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Ingen giltig sparad Top 3 finns. Preliminärt urval ur sessionens befintliga rankning; inte sparat, inte officiellt, inte ett köpbesked.</p>
    {quoteError && <p role="alert" className="mt-2 text-xs text-destructive">Kurshämtningen misslyckades. Planerna är oförändrade.</p>}
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {groups.map(g => <section key={g.direction} data-testid={`research-${g.direction}`} className="min-w-0">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{HEAD(g.direction)} · {g.picks.length}/3</h3>
        {!g.picks.length && <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">Inga förslag. Inga extra signaler skapas.</p>}
        <ul className="space-y-2">{g.picks.map(p => <ResearchCard key={p.candidateId} pick={p}
          signal={signals.find(c => c.id === p.candidateId && (c.signalDate ?? null) === (p.signalDate ?? null) &&
            c.entryPrice === p.entryPrice && c.stopPrice === p.stopPrice && c.targetPrice === p.targetPrice)}
          dataDate={null} quote={quotes[p.ticker]} warnings={pickWarnings(p, [], signals as Conflictable[])} />)}</ul>
      </section>)}
    </div>
  </>;
}

/** The single prominent Swedish research surface on / and /dashboard. */
export function SwedishResearch() {
  const last = useGetLastValidTop3({ query: { queryKey: getGetLastValidTop3QueryKey(), retry: false } });
  const s = last.data?.selection ?? null;
  const sessions = useListSessions({ query: { queryKey: ["/api/screener/sessions"], enabled: !last.isLoading && !s } });
  const id = s?.sessionId ?? (!last.isLoading ? sessions.data?.[0]?.id ?? 0 : 0);
  const detail = useGetSession(id, { query: { enabled: id > 0, queryKey: getGetSessionQueryKey(id) } });
  const prelim: DailyPick[] = !s && detail.data ? (detail.data.top3LiveSelection?.picks ?? []).flatMap(p => {
    const c = detail.data!.candidates.find(x => x.id === p.candidateId);
    return c ? [{ candidateId: p.candidateId, rank: p.rank, market: p.market ?? "", direction: p.direction, source: p.signalSource ?? "okänd",
      ticker: c.ticker, signalDate: c.signalDate, category: c.category, entryPrice: c.entryPrice, stopPrice: c.stopPrice, targetPrice: c.targetPrice, rr: c.rr }] : [];
  }).filter(p => !isolatedDailyPick(p, detail.data!.sourceReports ?? [])) : [];
  const shown = s ? swedishDailyPicks(researchPicks(s)).flatMap(g => g.picks) : swedishDailyPicks(prelim).flatMap(g => g.picks);
  const params = { tickers: [...new Set(shown.map(p => p.ticker))].join(",") };
  const quotes = useGetQuotes(params, { query: { enabled: false, retry: false, queryKey: getGetQuotesQueryKey(params) } });
  const map: Record<string, QuoteResult> = {};
  if (!quotes.isError) quotes.data?.forEach(q => { map[q.ticker] = q; });
  return <section data-testid="swedish-research" aria-busy={last.isLoading} className="rounded-lg border border-primary/30 bg-card p-3 sm:p-4 shadow-sm">
    {s ? <SwedishResearchContent selection={s} signals={(detail.data?.candidates ?? []) as ResearchSignal[]} reports={detail.data?.sourceReports ?? []} quotes={map}
      today={stockholmToday()} onRefresh={params.tickers ? () => void quotes.refetch() : undefined}
      refreshing={quotes.isFetching} quoteError={quotes.isError} />
      : prelim.length && detail.data ? <PreliminaryResearchContent picks={prelim} sessionDate={detail.data.date}
        signals={detail.data.candidates as ResearchSignal[]} quotes={map}
        onRefresh={params.tickers ? () => void quotes.refetch() : undefined} refreshing={quotes.isFetching} quoteError={quotes.isError} />
      : last.isLoading ? <div className="space-y-2"><div className="h-5 w-48 rounded bg-muted" /><div className="h-32 rounded bg-muted" /></div>
      : <p className="text-sm">Ingen giltig sparad Top 3 hittades. Inga picks gissas.</p>}
    {last.isError && <p role="alert" className="mt-2 text-xs text-amber-700">Status kunde inte hämtas.{" "}
      <button onClick={() => last.refetch()} className="underline" data-testid="button-retry-research">Försök igen</button></p>}
    {last.data?.warnings.map(w => <p key={w} role="status" className="mt-2 text-xs text-amber-700">{w}</p>)}
  </section>;
}
