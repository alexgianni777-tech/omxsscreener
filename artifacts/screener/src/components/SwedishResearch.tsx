import React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetLastValidTop3, getGetLastValidTop3QueryKey, useGetSession, getGetSessionQueryKey,
  useGetQuotes, getGetQuotesQueryKey, useListSessions, type QuoteResult, type SavedTop3Display, type SessionSourceReport,
} from "@workspace/api-client-react";
import { ResearchCard, type ResearchSignal } from "./ResearchCard";
import { marketDailyPicks, previousWeekday, oldSignalWarning, isolatedDailyPick, dailySymbol, type DailyPick } from "../lib/dailyCandidates";
import { stockholmToday } from "../lib/persistentTop3Display";
import { savedDataDate } from "../lib/researchQuote";
import { SourceProvenance } from "./SourceProvenance";
import { ResearchMarketSections, type MarketEvidenceSignal } from "./ResearchMarketSections";

export function researchPicks(selection: SavedTop3Display): DailyPick[] {
  return selection.revision.picks.map(p => ({ ...p, market: p.market ?? "", source: p.source ?? "okänd", signalDate: p.signalDate ?? null }));
}

export function SwedishResearchContent({ selection, signals = [], reports = [], statusReports, quotes = {}, today, onRefresh, refreshing = false, quoteError = false,
  diagnosticSignals, diagnosticReports, diagnosticDate }: {
  selection: SavedTop3Display; signals?: readonly ResearchSignal[]; reports?: readonly SessionSourceReport[]; quotes?: Record<string, QuoteResult>;
  today: string; onRefresh?: () => void; refreshing?: boolean; quoteError?: boolean;
  statusReports?: readonly SessionSourceReport[];
  diagnosticSignals?: readonly MarketEvidenceSignal[]; diagnosticReports?: readonly SessionSourceReport[]; diagnosticDate?: string;
}) {
  const picks = researchPicks(selection);
  const groups = marketDailyPicks(picks, "SE");
  const stale = selection.date !== today || selection.dataDates.some(d => !d.dataDate || d.dataDate !== previousWeekday(today));
  const official = selection.kind === "OFFICIAL";
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">Sverige &amp; USA · Top 3</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono" data-testid="text-research-date">Session {selection.date}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
            {official ? "Officiellt fryst urval" : `Ändringsbar rekommendation v${selection.revision.revision}`}</span>
          {stale && <span data-testid="status-research-stale" className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">STALE</span>}
          <span>Long {groups[0].picks.length}/3 · Short {groups[1].picks.length}/3</span>
          <span>USA: Long {marketDailyPicks(picks, "US")[0].picks.length}/3 · Short {marketDailyPicks(picks, "US")[1].picks.length}/3</span>
        </p>
      </div>
      <button type="button" data-testid="button-refresh-quotes" onClick={onRefresh} disabled={!onRefresh || refreshing}
        className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
        {refreshing ? "Hämtar priser…" : "Uppdatera priser"}</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      Senast giltiga sparade urval behålls tills ett nytt giltigt finns. Underlag från föregående stängning; inte ett köpbesked.
      {stale && " Gammalt eller ej styrkt datadatum: inget nytt köp utan egen liveverifiering."}
    </p>
    <SourceProvenance reports={statusReports ?? reports} context={statusReports ? "senaste kvitton per källa" : "urvalets session"} />
    {quoteError && <p role="alert" className="mt-2 text-xs text-destructive">Kurshämtningen misslyckades. Planerna är oförändrade; försök igen eller kontrollera Avanza.</p>}
    <ResearchMarketSections picks={picks} signals={diagnosticSignals ?? signals} reports={diagnosticReports ?? reports}
      sessionDate={diagnosticDate ?? selection.date} renderPick={p => <ResearchCard key={p.candidateId} pick={p}
          signal={signals.find(c => c.id === p.candidateId && (c.signalDate ?? null) === (p.signalDate ?? null) &&
            c.entryPrice === p.entryPrice && c.stopPrice === p.stopPrice && c.targetPrice === p.targetPrice)}
          dataDate={savedDataDate(selection.dataDates, p.source, p.signalDate, p.market)} quote={quotes[p.ticker]}
          warnings={pickWarnings(p, reports, signals as Conflictable[], statusReports ?? reports)}
          stale={selection.date !== today || oldSignalWarning(p.signalDate, today) != null ||
            savedDataDate(selection.dataDates, p.source, p.signalDate, p.market) !== previousWeekday(today)} />} />
    <Link href={`/sessions/${selection.sessionId}`} className="mt-4 inline-block text-xs font-medium text-primary hover:underline" data-testid="link-research-session">
      Öppna sessionen för versioner, fryst urval och utfall</Link>
  </>;
}

type Conflictable = ResearchSignal & { ticker?: string; market?: string | null; direction?: string };
/** Reuses existing quarantine helper and DailyCandidates' plan-conflict check; no new rules. */
export function pickWarnings(
  p: DailyPick,
  reports: readonly SessionSourceReport[],
  signals: readonly Conflictable[],
  sourceStatusReports: readonly SessionSourceReport[] = reports,
) {
  const out: string[] = [];
  const matching = reports.filter(r => r.status !== "FAILED" && r.source === p.source && r.signalDate === p.signalDate);
  const identity = [p.market, p.category, dailySymbol(p.ticker, p.market), p.direction, ...(p.signalDate ? [p.signalDate] : []), p.source].join("|");
  const quarantinedSomewhere = matching.some(r => r.quarantinedIdentities?.includes(identity));
  if (isolatedDailyPick(p, reports)) out.push("Källkonflikt – ingen entrybekräftelse");
  else if (quarantinedSomewhere) out.push("Källkonflikt osäker – rapportversion kan inte kopplas entydigt; ingen entrybekräftelse");
  if (signals.some(c => (c.market ?? "SE") === p.market && c.ticker &&
    (c.signalDate ?? null) === (p.signalDate ?? null) &&
    dailySymbol(c.ticker, p.market) === dailySymbol(p.ticker, p.market) &&
    (c.direction !== p.direction || c.entryPrice !== p.entryPrice || c.stopPrice !== p.stopPrice || c.targetPrice !== p.targetPrice)))
    out.push("Flera planer/riktningar för aktien – jämför innan beslut");
  const latestSourceReceipt = sourceStatusReports.filter(r => r.source === p.source).at(-1);
  if (latestSourceReceipt?.status === "FAILED") out.push(`Senaste ${p.source === "edgeai" ? "GitHub/EdgeAI" : "Telegram"}-import avvisades: ${latestSourceReceipt.error || "orsak okänd"}`);
  out.push(...(latestSourceReceipt?.warnings ?? []));
  return out;
}

/** An API failure is not evidence that no saved valid selection exists. */
export function allowPreliminaryResearch(success: boolean, selection: unknown) {
  return success && selection === null;
}

/** Shown only when no saved valid selection exists. Existing ranked live selection, unchanged. */
export function PreliminaryResearchContent({ picks, sessionDate, signals = [], statusReports, quotes = {}, onRefresh, refreshing = false, quoteError = false }: {
  picks: readonly DailyPick[]; sessionDate: string; signals?: readonly ResearchSignal[]; quotes?: Record<string, QuoteResult>;
  statusReports?: readonly SessionSourceReport[]; onRefresh?: () => void; refreshing?: boolean; quoteError?: boolean;
}) {
  const groups = marketDailyPicks(picks, "SE");
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">Sverige &amp; USA · Top 3</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">Session {sessionDate}</span>
          <span data-testid="status-research-preliminary" className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">PRELIMINÄR</span>
          <span>Long {groups[0].picks.length}/3 · Short {groups[1].picks.length}/3</span>
        </p>
      </div>
      <button type="button" data-testid="button-refresh-quotes" onClick={onRefresh} disabled={!onRefresh || refreshing}
        className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
        {refreshing ? "Hämtar priser…" : "Uppdatera priser"}</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Ingen giltig sparad Top 3 finns. Preliminärt urval ur sessionens befintliga rankning; inte sparat, inte officiellt, inte ett köpbesked.</p>
    {statusReports && <SourceProvenance reports={statusReports} context="senaste kvitton per källa" />}
    {quoteError && <p role="alert" className="mt-2 text-xs text-destructive">Kurshämtningen misslyckades. Planerna är oförändrade.</p>}
    <ResearchMarketSections picks={picks} signals={signals} reports={statusReports}
      sessionDate={sessionDate} renderPick={p => <ResearchCard key={p.candidateId} pick={p}
          signal={signals.find(c => c.id === p.candidateId && (c.signalDate ?? null) === (p.signalDate ?? null) &&
            c.entryPrice === p.entryPrice && c.stopPrice === p.stopPrice && c.targetPrice === p.targetPrice)}
          dataDate={null} quote={quotes[p.ticker]} warnings={pickWarnings(p, [], signals as Conflictable[], statusReports ?? [])} stale />} />
  </>;
}

/** The single prominent research surface for both markets. */
export function SwedishResearch({ latestReports }: { latestReports?: readonly SessionSourceReport[] } = {}) {
  const last = useGetLastValidTop3({ query: { queryKey: getGetLastValidTop3QueryKey(), retry: false } });
  const s = last.data?.selection ?? null;
  const canUsePreliminary = allowPreliminaryResearch(last.isSuccess, last.data?.selection);
  const sessions = useListSessions({ query: { queryKey: ["/api/screener/sessions"] } });
  const id = s?.sessionId ?? (canUsePreliminary ? sessions.data?.[0]?.id ?? 0 : 0);
  const detail = useGetSession(id, { query: { enabled: id > 0, queryKey: getGetSessionQueryKey(id) } });
  const latestId = sessions.data?.[0]?.id ?? 0;
  const latestDetail = useGetSession(latestId, { query: { enabled: latestId > 0, queryKey: getGetSessionQueryKey(latestId) } });
  const sourceStatus = useQuery<{ sourceReports?: SessionSourceReport[] }>({
    queryKey: ["/api/telegram-import/status"],
    enabled: !!s || canUsePreliminary,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch("/api/telegram-import/status", { credentials: "include" });
      if (!response.ok) throw new Error(`Importstatus HTTP ${response.status}`);
      return response.json() as Promise<{ sourceReports?: SessionSourceReport[] }>;
    },
  });
  const sourceReports = sourceStatus.data?.sourceReports ?? latestReports;
  const prelim: DailyPick[] = canUsePreliminary && detail.data ? (detail.data.top3LiveSelection?.picks ?? []).flatMap(p => {
    const c = detail.data!.candidates.find(x => x.id === p.candidateId);
    return c ? [{ candidateId: p.candidateId, rank: p.rank, market: p.market ?? "", direction: p.direction, source: p.signalSource ?? "okänd",
      ticker: c.ticker, signalDate: c.signalDate, category: c.category, entryPrice: c.entryPrice, stopPrice: c.stopPrice, targetPrice: c.targetPrice, rr: c.rr }] : [];
  }).filter(p => !isolatedDailyPick(p, detail.data!.sourceReports ?? [])) : [];
  const shown = (["SE", "US"] as const).flatMap(market => marketDailyPicks(s ? researchPicks(s) : prelim, market).flatMap(g => g.picks));
  const params = { tickers: [...new Set(shown.map(p => p.ticker))].join(",") };
  const quotes = useGetQuotes(params, { query: { enabled: false, retry: false, queryKey: getGetQuotesQueryKey(params) } });
  const map: Record<string, QuoteResult> = {};
  if (!quotes.isError) quotes.data?.forEach(q => { map[q.ticker] = q; });
  const loading = last.isLoading || (canUsePreliminary && (sessions.isLoading || detail.isLoading));
  return <section data-testid="swedish-research" aria-busy={loading} className="rounded-2xl bg-card p-4 sm:p-6 shadow-sm ring-1 ring-primary/20">
    {s ? <SwedishResearchContent selection={s} signals={(detail.data?.candidates ?? []) as ResearchSignal[]} reports={detail.data?.sourceReports ?? []} statusReports={sourceReports} quotes={map}
      diagnosticSignals={latestDetail.data?.candidates} diagnosticReports={latestDetail.data?.sourceReports} diagnosticDate={latestDetail.data?.date}
      today={stockholmToday()} onRefresh={params.tickers ? () => void quotes.refetch() : undefined}
      refreshing={quotes.isFetching} quoteError={quotes.isError} />
      : detail.data && canUsePreliminary ? <PreliminaryResearchContent picks={prelim} sessionDate={detail.data.date}
        signals={detail.data.candidates as ResearchSignal[]} statusReports={sourceReports} quotes={map}
        onRefresh={params.tickers ? () => void quotes.refetch() : undefined} refreshing={quotes.isFetching} quoteError={quotes.isError} />
      : loading ? <div className="space-y-2"><div className="h-5 w-48 rounded bg-muted" /><div className="h-32 rounded bg-muted" /></div>
      : <><p className="text-sm">{last.isError ? "Inget urval kunde verifieras." : "Ingen giltig sparad Top 3 hittades. Inga picks gissas."}</p>
        <ResearchMarketSections picks={[]} sessionDate="" renderPick={() => null} /></>}
    {latestDetail.isError && <p role="alert" className="mt-2 text-xs text-destructive">Senaste sessionens diagnos kunde inte hämtas. Datumorsaker för det sparade urvalet visas i stället; nyare data är inte verifierade.</p>}
    {id > 0 && detail.isError && <p role="alert" className="mt-2 text-xs text-destructive">
      Sessionsdetaljer och källkvitton kunde inte hämtas. Sparat urval ändras inte.{" "}
      <button onClick={() => detail.refetch()} className="underline" data-testid="button-retry-session-details">Försök igen</button>
    </p>}
    {last.isError && <p role="alert" className="mt-2 text-xs text-amber-700">Status kunde inte hämtas.{" "}
      <button onClick={() => last.refetch()} className="underline" data-testid="button-retry-research">Försök igen</button></p>}
    {last.data?.warnings.map(w => <p key={w} role="status" className="mt-2 text-xs text-amber-700">{w}</p>)}
  </section>;
}
