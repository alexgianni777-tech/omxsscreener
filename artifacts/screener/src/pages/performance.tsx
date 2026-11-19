import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  getListJournalRecordsQueryKey,
  useListJournalRecords,
  type JournalRecord,
} from "@workspace/api-client-react";
import { JournalAnalysis } from "../components/JournalAnalysis";
import { executionAnalysis } from "../lib/journalAnalysis";
import { performanceLabMetrics } from "../lib/performanceLabMetrics";

type Mode = "REAL" | "SIMULATED" | "NOT_TAKEN";
const modes: Mode[] = ["REAL", "SIMULATED", "NOT_TAKEN"];

function fmt(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "ej verifierat" : value.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
}

function RecordRow({ record }: { record: JournalRecord }) {
  const verification = executionAnalysis(record);
  return <article className="grid gap-3 border-t border-border px-4 py-3 text-xs sm:grid-cols-[1.2fr_1fr_1fr_1fr]" data-testid={`performance-record-${record.id}`}>
    <div><p className="font-mono font-semibold">{record.signal.ticker} · {record.signal.direction}</p>
      <p className="mt-1 text-muted-foreground">{record.signal.source ?? "källa okänd"} · signal {record.signal.signalDate ?? "datum okänt"}</p></div>
    <div><p className="text-muted-foreground">Mode / registrerad</p><p className="mt-1">{record.input.mode} · {record.createdAt}</p></div>
    <div><p className="text-muted-foreground">Fill → exit</p><p className="mt-1 font-mono">{fmt(record.input.fillPrice)} → {fmt(record.input.exitPrice)}</p></div>
    <div><p className="text-muted-foreground">Netto R / verifiering</p><p className="mt-1 font-mono">{fmt(verification.netR)} · {verification.verification}</p></div>
    {verification.issues.length > 0 && <p className="sm:col-span-4 text-amber-800 dark:text-amber-300">{verification.issues.join(" ")}</p>}
  </article>;
}

export function Performance() {
  const recordsQuery = useListJournalRecords({ query: { queryKey: getListJournalRecordsQueryKey() } });
  const records = recordsQuery.data ?? [];
  const [mode, setMode] = useState<Mode>("REAL");
  const counts = useMemo(() => ({
    REAL: records.filter(r => r.input.mode === "REAL").length,
    SIMULATED: records.filter(r => r.input.mode === "SIMULATED").length,
    NOT_TAKEN: records.filter(r => r.input.mode === "NOT_TAKEN").length,
  }), [records]);
  const metrics = useMemo(() => performanceLabMetrics(records), [records]);
  const shown = records.filter(r => r.input.mode === mode);
  const interval = (values: [number, number] | null, percent = false) => values
    ? `${fmt(percent ? values[0] * 100 : values[0])}–${fmt(percent ? values[1] * 100 : values[1])}${percent ? "%" : " R"}`
    : "ej beräkningsbar";

  return <section className="space-y-5" data-testid="workspace-performance" aria-busy={recordsQuery.isLoading}>
    <header>
      <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-primary">AGIC / Execution evidence</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Performance Lab</h1>
      <p className="mt-1 text-sm text-muted-foreground">Faktiska journalposter, separerade efter mode. Inga signalutfall eller simuleringar räknas om till verkliga affärer.</p>
    </header>
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4" data-testid="performance-real-progress">
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">Verifierade REAL-poster</p>
        <p className="mt-2 font-mono text-3xl font-semibold">{recordsQuery.isError ? "—" : metrics.verifiedRealCount}<span className="text-base text-muted-foreground"> / {metrics.targetRealCount}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">Räkning av aritmetiskt verifierade REAL-poster med netto-R. 50 är uppföljningsmål, inte ett bevis på edge.</p>
      </div>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" data-testid="performance-backtest-status">
        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4" /><p className="text-[10px] font-semibold uppercase tracking-[.16em]">BACKTEST NOT VERIFIED</p></div>
        <p className="mt-2 text-xs leading-relaxed text-amber-950 dark:text-amber-200">Journal-API:t innehåller inget backtestläge eller backtestdata. Inga backtestresultat visas eller härleds.</p>
      </div>
    </div>
    {!recordsQuery.isError && <section className="rounded-xl border border-border bg-card p-4" data-testid="performance-real-summary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">REAL · sammanfattning av verifierade avslut</h2>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="performance-evidence-status">{metrics.evidenceStatus}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <div><dt className="text-[10px] text-muted-foreground">Netto expectancy</dt><dd className="mt-1 font-mono text-sm">{metrics.netExpectancyR == null ? "ej verifierat" : `${fmt(metrics.netExpectancyR)} R`}</dd></div>
        <div><dt className="text-[10px] text-muted-foreground">95% intervall · expectancy</dt><dd className="mt-1 font-mono text-sm">{interval(metrics.expectancy95Ci)}</dd></div>
        <div><dt className="text-[10px] text-muted-foreground">Win rate · REAL</dt><dd className="mt-1 font-mono text-sm">{metrics.winRate == null ? "ej verifierat" : `${fmt(metrics.winRate * 100)}%`}</dd></div>
        <div><dt className="text-[10px] text-muted-foreground">95% intervall · win rate</dt><dd className="mt-1 font-mono text-sm">{interval(metrics.winRate95Ci, true)}</dd></div>
        <div><dt className="text-[10px] text-muted-foreground">Profit factor</dt><dd className="mt-1 font-mono text-sm">{fmt(metrics.profitFactor)} · {metrics.profitFactorStatus}</dd></div>
        <div><dt className="text-[10px] text-muted-foreground">Max drawdown</dt><dd className="mt-1 font-mono text-sm">{metrics.maxDrawdownR == null ? "ej verifierat" : `${fmt(metrics.maxDrawdownR)} R`} · {metrics.drawdownStatus}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Verifierade REAL {metrics.verifiedRealCount} · exkluderade REAL {metrics.excludedRealCount} · SIMULATED {metrics.simulatedCount} · NOT_TAKEN {metrics.notTakenCount}.
        {" "}Intervallen är deskriptiva, inte edge-bevis; små och tomma urval visas som otillräckliga eller ej verifierade.
      </p>
    </section>}
    <div className="flex flex-wrap gap-2" aria-label="Journalposter per mode">
      {modes.map(item => <button key={item} type="button" onClick={() => setMode(item)} data-testid={`button-performance-mode-${item}`}
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${mode === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
        {item} <span className="ml-1 font-mono">{recordsQuery.isError ? "—" : counts[item]}</span>
      </button>)}
    </div>

    {recordsQuery.isLoading && <div className="space-y-3" data-testid="performance-loading">
      {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
    </div>}
    {recordsQuery.isError && <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-4 text-sm" data-testid="performance-error">
      Journalen kunde inte läsas; inga tomma eller syntetiska resultat används.
      <button onClick={() => recordsQuery.refetch()} className="ml-2 inline-flex items-center gap-1 text-primary underline" data-testid="button-performance-retry">
        <RefreshCw className="h-3 w-3" /> Försök igen
      </button>
    </div>}
    {!recordsQuery.isLoading && !recordsQuery.isError && <>
      <details className="rounded-xl border border-border bg-card p-4" data-testid="performance-detailed-analysis">
        <summary className="cursor-pointer text-sm font-semibold">Detaljerad analys och datakvalitet</summary>
        <p className="mt-2 text-xs text-muted-foreground">Analysen använder endast verifierade avslut där fälten räcker. Grupper med litet eller ofullständigt underlag är inte edge-bevis.</p>
        <JournalAnalysis records={records} />
      </details>
      <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="performance-mode-records">
        <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-semibold">{mode} · journalrader</h2>
          <p className="text-[10px] text-muted-foreground">Mode hålls separat · importerat urfall är inte execution-journal</p>
        </header>
        {shown.length ? shown.map(record => <RecordRow key={record.id} record={record} />) :
          <div className="border-t border-dashed border-border px-4 py-8 text-center" data-testid={`performance-empty-${mode}`}>
            <p className="text-sm font-medium">Inga {mode} journalposter</p>
            <p className="mt-1 text-xs text-muted-foreground">Annat mode, historiska signalutfall och backtest fyller inte denna vy.</p>
          </div>}
      </section>
    </>}
  </section>;
}
