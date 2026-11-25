import { useListSessions, useGetSession, getGetSessionQueryKey, useGetQuotes, getGetQuotesQueryKey, type QuoteResult } from "@workspace/api-client-react";
import { quoteRequestTicker } from "../lib/researchQuote";
import {
  filterActiveOmxs30Picks,
  filterArchivedOmxs30Picks,
  OMXS30_TOP3_POLICY_VERSION,
} from "../lib/omxs30ActiveView";
import { CurrentTop3Selection } from "./CurrentTop3Selection";
import { DailyCandidates } from "./DailyCandidates";
import { Link } from "wouter";

/** Current recommendations are explicitly separate from the original statistical cohort. */
export function DashboardLiveTop3() {
  const sessions = useListSessions();
  const id = sessions.data?.[0]?.id ?? 0;
  const detail = useGetSession(id, { query: { enabled: id > 0, queryKey: getGetSessionQueryKey(id) } });
  const revisions = (detail.data?.top3Revisions ?? [])
    .filter((revision) => revision.policyVersion === OMXS30_TOP3_POLICY_VERSION)
    .map((revision) => ({
      ...revision,
      picks: filterActiveOmxs30Picks(revision.picks, detail.data?.date ?? ""),
    }))
    .sort((a, b) => b.revision - a.revision);
  const current = revisions[0];
  const candidatesById = new Map((detail.data?.candidates ?? []).map((candidate) => [candidate.id, candidate]));
  const livePicksWithIdentity = (detail.data?.top3LiveSelection?.picks ?? []).flatMap((pick) => {
    const candidate = candidatesById.get(pick.candidateId);
    // The live-selection API stores candidateId, not ticker. Missing candidate
    // details must fail closed rather than bypass the OMXS30 identity check.
    return candidate?.ticker ? [{ ...pick, ticker: candidate.ticker }] : [];
  });
  const liveCandidates = filterActiveOmxs30Picks(livePicksWithIdentity, detail.data?.date ?? "");
  const visiblePicks = current?.picks ?? liveCandidates;
  const archivedPickCount = (detail.data?.top3Revisions ?? []).reduce(
    (count, revision) => count + filterArchivedOmxs30Picks(revision.picks, detail.data?.date ?? "").length,
    0,
  );
  const params = { tickers: [...new Set(visiblePicks.map(p => quoteRequestTicker(p.ticker, p.market)))].join(",") };
  const quotes = useGetQuotes(params, { query: { enabled: false, queryKey: getGetQuotesQueryKey(params), retry: false } });
  const quoteMap: Record<string, QuoteResult> = {};
  quotes.data?.forEach(q => { quoteMap[q.ticker] = quotes.isError ? { ...q, error: "Kurshämtningen misslyckades." } : q; });
  return (
    <section data-testid="dashboard-live-top3" className="space-y-3">
      {detail.data && <DailyCandidates picks={visiblePicks}
        signals={detail.data.candidates} reports={detail.data.sourceReports}
        sessionDate={detail.data.date} preliminary={!current} />}
      <details>
      <summary className="cursor-pointer text-sm text-muted-foreground">Top 3-detaljer · OMXS30 och Live Entry Guard</summary>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Aktuella OMXS30 Top 3 · screening och live-entry</h3>
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
          ? <CurrentTop3Selection revisions={revisions} sessionId={id} quotes={quoteMap} candidates={detail.data.candidates} />
          : <p className="text-sm text-muted-foreground">Inget aktuellt OMXS30-urval med godkänd policyversion finns. Äldre eller utanför-index-picks ersätter inte ett aktuellt entrybesked.</p>}
      {archivedPickCount > 0 && detail.data && (
        <p role="status" className="text-xs text-amber-700" data-testid="dashboard-top3-archive-count">
          {archivedPickCount} äldre eller utanför OMXS30-picks finns kvar i sessionens historikarkiv. De visas inte som aktiva eller entrybekräftade.
          {" "}<Link href={`/sessions/${id}`} className="underline">Öppna sessionshistoriken</Link>
        </p>
      )}
      </details>
    </section>
  );
}
