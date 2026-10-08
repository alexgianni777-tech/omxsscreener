import { useListSessions, useGetSession, getGetSessionQueryKey, useGetQuotes, getGetQuotesQueryKey, type QuoteResult } from "@workspace/api-client-react";
import { CurrentTop3Selection } from "./CurrentTop3Selection";
import { DailyCandidates } from "./DailyCandidates";

/** Current recommendations are explicitly separate from the original statistical cohort. */
export function DashboardLiveTop3() {
  const sessions = useListSessions();
  const id = sessions.data?.[0]?.id ?? 0;
  const detail = useGetSession(id, { query: { enabled: id > 0, queryKey: getGetSessionQueryKey(id) } });
  const current = [...(detail.data?.top3Revisions ?? [])].sort((a, b) => b.revision - a.revision)[0];
  const params = { tickers: [...new Set(current?.picks.map(p => p.ticker) ?? [])].join(",") };
  const quotes = useGetQuotes(params, { query: { enabled: false, queryKey: getGetQuotesQueryKey(params), retry: false } });
  const quoteMap: Record<string, QuoteResult> = {};
  quotes.data?.forEach(q => { quoteMap[q.ticker] = quotes.isError ? { ...q, error: "Kurshämtningen misslyckades." } : q; });
  return (
    <section data-testid="dashboard-live-top3" className="space-y-3">
      {detail.data && <DailyCandidates picks={current?.picks ?? detail.data.top3LiveSelection?.picks ?? []}
        signals={detail.data.candidates} reports={detail.data.sourceReports}
        sessionDate={detail.data.date} preliminary={!current} />}
      <details>
      <summary className="cursor-pointer text-sm text-muted-foreground">Top 3-detaljer, USA och Live Entry Guard</summary>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Aktuella Top 3 · screening och live-entry</h3>
        <button type="button" disabled={!params.tickers || quotes.isFetching}
          onClick={() => void quotes.refetch()}
          className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50">
          {quotes.isFetching ? "Hämtar kurs…" : "Kontrollera aktuella priser"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Screeningstatus är inte ett entrybesked. Endast READY uppfyller prisvillkoren; övriga live-statusar betyder ingen genomförbar entry.
        READY ersätter inte en aktuell godkänd signal eller manuell rapportkontroll. Kurser hämtas manuellt, inte genom ny polling.
      </p>
      {(sessions.isError || detail.isError || quotes.isError) &&
        <p role="alert" className="text-sm text-destructive">Kunde inte verifiera underlaget. Ingen entry kan bekräftas; kontrollera data och försök igen.</p>}
      {sessions.isLoading || (id > 0 && detail.isLoading)
        ? <p className="text-sm text-muted-foreground">Hämtar aktuellt urval…</p>
        : detail.data && current
          ? <CurrentTop3Selection revisions={detail.data.top3Revisions!} sessionId={id} quotes={quoteMap} candidates={detail.data.candidates} />
          : <p className="text-sm text-muted-foreground">Inget aktuellt versionssparat Top 3-urval finns. Historiska statistik-picks ersätter inte ett aktuellt entrybesked.</p>}
      </details>
    </section>
  );
}
