import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowUpRight, CircleAlert, RefreshCw } from "lucide-react";
import {
  getGetLastValidTop3QueryKey,
  getGetSessionQueryKey,
  getListSessionsQueryKey,
  useGetLastValidTop3,
  useGetSession,
  useListSessions,
  type Candidate,
  type SessionSourceReport,
} from "@workspace/api-client-react";
import { advisoryTrend } from "../lib/sourceMarketEvidence";
import { candidateReceipt, radarSourceHealth, selectRadarLane } from "../lib/marketRadarModel";
import { activeOmxs30Candidate, filterActiveOmxs30Picks } from "../lib/omxs30ActiveView";

const sourceName: Record<string, string> = {
  edgeai: "EdgeAI",
  telegram: "Telegram",
  manual: "Manuell",
  screener: "Screener",
  oraklet: "Oraklet",
};

function when(value?: string | null) {
  if (!value) return "ej registrerad";
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })
    : value;
}

function Quality({ candidate }: { candidate: Candidate }) {
  const q = candidate.dataQuality;
  const reasons = [...(q?.reasons ?? []), ...(candidate.review?.reasons ?? []), ...(candidate.decision?.reasons ?? [])];
  return (
    <details className="mt-3 border-t border-border/70 pt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Datakvalitet och skäl</summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Kvalitetskälla</dt><dd>{q?.source ?? "okänd"}</dd></div>
        <div><dt className="text-muted-foreground">Evidence</dt><dd>{q?.evidenceStatus ?? "okänd"}</dd></div>
        <div><dt className="text-muted-foreground">Elite</dt><dd>{q?.eliteStatus ?? "okänd"} · kvalificerad {String(q?.eliteQualified ?? "okänt")}</dd></div>
        <div><dt className="text-muted-foreground">Bar source</dt><dd>{q?.barSource ?? "okänd"}</dd></div>
        <div><dt className="text-muted-foreground">Full session verifierad</dt><dd>{String(q?.fullSessionVerified ?? "okänt")}</dd></div>
        <div><dt className="text-muted-foreground">Entry eligible</dt><dd>{String(q?.entryEligible ?? "okänt")}</dd></div>
      </dl>
      {reasons.length > 0
        ? <ul className="mt-2 list-inside list-disc space-y-1 text-amber-800 dark:text-amber-300">{reasons.map((reason, i) => <li key={`${i}-${reason}`}>{reason}</li>)}</ul>
        : <p className="mt-2 text-muted-foreground">Inga skäl rapporterade. Okänt är inte godkänt.</p>}
    </details>
  );
}

function CandidateTile({ candidate, reports }: { candidate: Candidate; reports: SessionSourceReport[] }) {
  const market = candidate.market;
  const source = candidate.signalSource ?? "unknown";
  const report = candidateReceipt(candidate, reports);
  const trend = market === "SE" || market === "US" ? advisoryTrend(reports, market) : null;
  const marketDataDate = candidate.dataQuality?.dataAsOf ??
    (report && (market === "SE" || market === "US") ? report.dataDates?.[market] : null);
  const trendMatchesCandidate = !!trend?.date && !!marketDataDate && trend.date === marketDataDate;
  const decision = candidate.decision?.status ?? "okänd";
  const isLong = candidate.direction === "LONG";
  return (
    <article className="surface-lift rounded-xl border border-border/80 bg-card p-4 shadow-sm" data-testid={`radar-candidate-${candidate.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-xl font-semibold tracking-tight">{candidate.ticker}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[.12em] ${isLong ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>{candidate.direction}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{market ?? "MARKNAD OKÄND"}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{candidate.category} · {sourceName[source] ?? source} · rank {candidate.rank}</p>
        </div>
        <span className="rounded-md border border-border bg-muted/50 px-2.5 py-1 font-mono text-[11px] font-semibold" data-testid={`radar-decision-${candidate.id}`}>
          {decision}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div><p className="text-muted-foreground">Signaldag</p><p className="mt-1 font-mono">{candidate.signalDate ?? "okänd"}</p></div>
        <div><p className="text-muted-foreground">Marknadsdag</p><p className="mt-1 font-mono">{marketDataDate ?? "ej verifierad"}</p></div>
        <div><p className="text-muted-foreground">Beslutskontroll</p><p className="mt-1">{candidate.review?.status ?? "okänd"}</p></div>
        <div><p className="text-muted-foreground">Källstatus</p><p className="mt-1">{report?.status ?? "inget separat kvitto"}</p></div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground" data-testid={`radar-source-time-${candidate.id}`}>
        Källa: {sourceName[source] ?? source} · rapportdag {report?.reportDate ?? "okänd"} · signaldag {report?.signalDate ?? candidate.signalDate ?? "okänd"} ·
        {" "}importerad {when(report?.importedAt)}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs sm:grid-cols-4">
        <div><span className="text-muted-foreground">Trend / regim</span><p className="mt-1">
          {trendMatchesCandidate ? trend?.status : "UNKNOWN · datadag matchar ej"}
          {trend?.date ? ` · ${trend.date}` : ""}
        </p></div>
        <div><span className="text-muted-foreground">1 mån / RS 3 mån</span><p className="mt-1 font-mono">{candidate.perf1m} / {candidate.rs3m}</p></div>
        <div><span className="text-muted-foreground">RSI / %B</span><p className="mt-1 font-mono">{candidate.rsi} / {candidate.pctB}</p></div>
        <div><span className="text-muted-foreground">ATR / volym</span><p className="mt-1 font-mono">{candidate.atr} / {candidate.volMultiplier}× · {candidate.volumeAsOf ?? "datum okänt"}</p></div>
      </div>
      <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        Researchkandidat · beslut {decision} · ingen signal uppgraderas till READY och detta är inget orderbesked.
      </div>
      <Quality candidate={candidate} />
      <Link href={`/trade-desk?candidate=${candidate.id}`} data-testid={`link-trade-desk-${candidate.id}`}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
        Granska i Trade Desk <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </article>
  );
}

export function Radar() {
  const sessions = useListSessions({ query: { queryKey: getListSessionsQueryKey() } });
  const latestId = sessions.data?.[0]?.id ?? 0;
  const detail = useGetSession(latestId, { query: { enabled: latestId > 0, queryKey: getGetSessionQueryKey(latestId) } });
  const lastTop3 = useGetLastValidTop3({ query: { queryKey: getGetLastValidTop3QueryKey() } });
  const storedCandidates = detail.data?.candidates ?? [];
  const candidates = detail.data
    ? storedCandidates.filter(candidate => activeOmxs30Candidate({
        ticker: candidate.ticker, market: candidate.market, sessionDate: detail.data!.date,
      }))
    : [];
  const archivedCandidateCount = storedCandidates.length - candidates.length;
  const grouped = useMemo(() => {
    const lanes: Record<string, Candidate[]> = {};
    for (const direction of ["LONG", "SHORT"] as const) {
      const key = `SE-${direction}`;
      lanes[key] = selectRadarLane(candidates, "SE", direction, 5) as Candidate[];
    }
    return lanes;
  }, [candidates]);
  const reports = detail.data?.sourceReports ?? [];
  const sourceHealth = radarSourceHealth(candidates, reports);
  const screenerTop = candidates.filter(c => c.signalSource === "screener" ||
    String(c.signalSource ?? "").toLowerCase() === "oraklet")
    .slice().sort((a, b) => a.rank - b.rank || a.ticker.localeCompare(b.ticker)).slice(0, 3);
  const laneKeys = ["SE-LONG", "SE-SHORT"];

  return (
    <section className="space-y-5" data-testid="workspace-radar" aria-busy={sessions.isLoading || detail.isLoading}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-primary">AGIC / Research</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Marknadsradar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Källseparerad kandidatvy ur senaste sessionen. Inget urval eller beslut skrivs om.</p>
        </div>
        {detail.data && <div className="rounded-lg border border-border bg-card px-3 py-2 text-right" data-testid="radar-session-date">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Senaste session</p>
          <p className="font-mono text-sm">{detail.data.date} · #{detail.data.id}</p>
        </div>}
      </header>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-relaxed">
          Aktiva kandidater visas endast för verifierade OMXS30-medlemmar på sessionsdatumet, högst fem per riktning.
          WATCH, RESEARCH och STALE är researchstatus, aldrig ordergodkännande.
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs" data-testid="radar-top3-context">
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${lastTop3.data?.selection ? "bg-primary" : "bg-muted-foreground/40"}`} />
          Sparad officiell/rekommendationslista {lastTop3.isLoading ? "läser…" : lastTop3.data?.selection ? "finns" : "saknas"}
          {lastTop3.data?.selection && <details className="mt-2 border-t border-border pt-2">
            <summary className="cursor-pointer font-medium">
              Visa sparad lista · {lastTop3.data.selection.date} · {lastTop3.data.selection.kind} · rev {lastTop3.data.selection.revision.revision}
            </summary>
            <p className="mt-2 text-muted-foreground">Endast datumstyrda OMXS30-picks visas här. Originalsignaler och datadagar är bevakningsunderlag, inte orderbekräftelse.</p>
            {lastTop3.data.selection.revision.picks.length > filterActiveOmxs30Picks(lastTop3.data.selection.revision.picks, lastTop3.data.selection.date).length &&
              <p className="mt-2 text-amber-700">Äldre eller utanför-index-picks finns endast i sessionshistoriken.</p>}
            {filterActiveOmxs30Picks(lastTop3.data.selection.revision.picks, lastTop3.data.selection.date).length ? <ul className="mt-2 divide-y divide-border">
              {filterActiveOmxs30Picks(lastTop3.data.selection.revision.picks, lastTop3.data.selection.date).map(pick => {
                const pickDataDate = lastTop3.data?.selection?.dataDates.find(item =>
                  item.market === pick.market && item.source === pick.source && item.signalDate === (pick.signalDate ?? null),
                )?.dataDate ?? pick.dataQuality?.dataAsOf ?? null;
                return <li key={`${pick.market}-${pick.direction}-${pick.candidateId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><strong className="font-mono">{pick.ticker}</strong> · {pick.market} {pick.direction} · {pick.signalDate ?? "datum okänt"} · datadag {pickDataDate ?? "ej verifierad"} · {pick.decision.status}</span>
                  <Link href={`/trade-desk?session=${lastTop3.data?.selection?.sessionId}&candidate=${pick.candidateId}`}
                    data-testid={`link-saved-top3-${pick.candidateId}`} className="font-semibold text-primary hover:underline">Granska plan</Link>
                </li>;
              })}
            </ul> : <p className="mt-2 text-muted-foreground">Inga aktiva OMXS30-picks i den sparade listan.</p>}
            {lastTop3.data.warnings.length > 0 &&
              <p className="mt-2 text-amber-800 dark:text-amber-300">{lastTop3.data.warnings.length} sparad varning(ar); kontrollera originalsessionen.</p>}
          </details>}
        </div>
      </div>

      {sessions.isLoading && <div className="space-y-3" data-testid="radar-loading">
        {[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
      </div>}
      {sessions.isError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <div className="flex items-center gap-2"><CircleAlert className="h-4 w-4" /> Sessioner kunde inte läsas. Kandidater visas inte från en annan eller gammal källa.</div>
        <button onClick={() => sessions.refetch()} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary" data-testid="button-radar-retry">
          <RefreshCw className="h-3 w-3" /> Försök igen
        </button>
      </div>}
      {!sessions.isLoading && !sessions.isError && !latestId && <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="radar-empty">
        <h2 className="font-semibold">Ingen session att granska</h2>
        <p className="mt-1 text-sm text-muted-foreground">Importera eller skapa inte ny data här. Radarn väntar på befintlig session.</p>
      </div>}
      {latestId > 0 && detail.isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted" data-testid="radar-detail-loading" />}
      {latestId > 0 && detail.isError && <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm" data-testid="radar-detail-error">
        Senaste sessionsdetaljer kunde inte hämtas. <button onClick={() => detail.refetch()} className="underline" data-testid="button-radar-detail-retry">Försök igen</button>
      </div>}
      {detail.data && <>
        <div className="rounded-xl border border-border bg-card p-4" data-testid="radar-source-reports">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">Källkvitton · aktuell session</h2>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{reports.length} rapporter</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {sourceHealth.map(item => <div key={item.source} className="min-w-0 rounded-lg bg-muted/50 p-3 text-xs" data-testid={`radar-health-${item.source}`}>
              <div className="flex justify-between gap-2"><strong>{sourceName[item.source] ?? item.source}</strong>
                <span className={item.status === "FAILED" ? "text-destructive" : item.status === "IMPORTED" ? "text-success" : "text-muted-foreground"}>
                  {item.status === "FAILED" ? "IMPORTFEL" : item.status === "IMPORTED" ? "KVITTERAD" : "EJ KVITTERAD I SESSION"}
                </span></div>
              <p className="mt-1 text-muted-foreground">{item.candidateCount} kandidater i senaste sessionen</p>
              {item.latest && <p className="mt-1 text-muted-foreground">Senaste svenska datakvitto · {item.latest.dataDates?.SE ?? "ej verifierat"}</p>}
            </div>)}
          </div>
          {reports.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {reports.map((r, i) => <div key={`${r.source}-${r.importedAt}-${i}`} className="min-w-0 rounded-lg bg-muted/50 p-3 text-xs" data-testid={`radar-source-report-${i}`}>
              <div className="flex justify-between gap-2"><strong>{sourceName[r.source.toLowerCase()] ?? r.source}</strong><span className={r.status === "SUCCESS" ? "text-success" : "text-destructive"}>{r.status ?? "STATUS OKÄND"}</span></div>
              <p className="mt-1 text-muted-foreground">Signal {r.signalDate} · rapport {r.reportDate}</p>
              <p className="mt-1 text-muted-foreground">Import {when(r.importedAt)} · OMXS30-data {r.dataDates?.SE ?? "ej verifierat"}</p>
              {r.warnings?.length ? <p className="mt-1 text-amber-800 dark:text-amber-300">{r.warnings.length} varning(ar) · se sessionen för detaljer</p> : null}
            </div>)}
          </div> : <p className="mt-2 text-xs text-muted-foreground">Inga källrapporter registrerade i den här sessionen.</p>}
          {screenerTop.length > 0 ? <section className="mt-3 border-t border-border pt-3" data-testid="radar-screener-top3">
            <h3 className="text-xs font-semibold">Svensk screener / Oraklet-bevakning · upp till 3</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Visas endast när kandidatens källfält anger screener/Oraklet. Researchbevakning, inte kvalificerad entry.</p>
            <div className="mt-2 flex flex-wrap gap-2">{screenerTop.map(candidate =>
              <Link key={candidate.id} href={`/trade-desk?candidate=${candidate.id}`} data-testid={`link-screener-top3-${candidate.id}`}
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs hover:border-primary/40">
                <strong className="font-mono">{candidate.ticker}</strong> · {candidate.direction} · {candidate.signalDate ?? "datum okänt"} · WATCH
              </Link>)}</div>
          </section> : <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground" data-testid="radar-oraklet-missing">
            Ingen särskilt märkt svensk screener/Oraklet-kandidat mottagen i aktuell session.
          </p>}
        </div>
        {candidates.length === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="radar-no-candidates">
          Sessionen innehåller inga kandidater.
        </div>}
        {archivedCandidateCount > 0 && detail.data && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800" data-testid="radar-archive-count">
          {archivedCandidateCount} äldre eller utanför-index-kandidat(er) dolda från aktiva spår; originalposter finns kvar i{" "}
          <Link href={`/sessions/${detail.data.id}`} className="underline">sessionsarkivet</Link>.
        </p>}
        {laneKeys.map(key => {
          const [market, direction] = key.split("-");
          const lane = grouped[key] ?? [];
          return <section key={key} className="space-y-3" data-testid={`radar-lane-${key.toLowerCase()}`}>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold">{market} <span className={direction === "LONG" ? "text-success" : "text-destructive"}>· {direction}</span></h2>
              <span className="font-mono text-[11px] text-muted-foreground">{lane.length}/5</span>
            </div>
            {lane.length ? <div className="grid gap-3 lg:grid-cols-2">
              {lane.map(c => <CandidateTile key={c.id} candidate={c} reports={reports} />)}
            </div> : <div className="rounded-lg border border-dashed border-border/80 px-4 py-3 text-xs text-muted-foreground">Inga {market} {direction.toLowerCase()}-kandidater i den senaste sessionen.</div>}
          </section>;
        })}
      </>}
    </section>
  );
}
