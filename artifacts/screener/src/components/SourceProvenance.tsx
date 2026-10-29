import React from "react";
import type { SessionSourceReport } from "@workspace/api-client-react";

function day(value?: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "okänd";
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : "okänd";
}

function importTime(value?: string): string {
  // A date without a clock and timezone is not a verified import timestamp.
  if (!value || !/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return "okänd";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "okänd";
}

/** Stored session receipts only: no requests, polling or inferred market dates. */
export function SourceProvenance({ reports = [], context }: { reports?: readonly SessionSourceReport[]; context?: string }) {
  const sources = ["telegram", "edgeai"].map(source => {
    const history = reports.filter(r => r.source === source);
    const latest = history.at(-1);
    const accepted = [...history].reverse().find(r => r.status === "SUCCESS");
    const status = latest?.status === "FAILED" ? "Import avvisad"
      : !latest ? "Importkvittens saknas"
      : latest.status !== "SUCCESS" ? "Kvittens · status ej verifierad"
      : latest.warnings?.length ? "Importerad · varningar" : "Importerad";
    return { source, latest, accepted, status };
  });
  const verified = sources.every(s => s.latest?.status === "SUCCESS");
  const completeDates = sources.every(s => day(s.latest?.reportDate) !== "okänd" && day(s.latest?.dataDates?.SE) !== "okänd");
  const a = sources[0].latest;
  const b = sources[1].latest;
  const alignment = !verified || !completeDates
    ? "Synkronisering ej verifierad – importstatus eller datadag saknas/är avvisad."
    : a!.reportDate !== b!.reportDate || a!.dataDates.SE !== b!.dataDates.SE
      ? "Olika rapport-/datadagar – källorna är inte datumssynkroniserade."
      : "Rapport- och datadag överensstämmer; källorna kan ändå ha olika signaler.";
  const alignWarn = !alignment.startsWith("Rapport- och datadag överensstämmer");
  return <div data-testid="source-provenance" className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
    {context && <p className="mb-1 font-medium text-foreground">Källstatus · {context}</p>}
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {sources.map(s => <p key={s.source} data-testid={`source-provenance-${s.source}`} className="break-words">
        <span className={s.latest?.status === "FAILED" ? "font-semibold text-destructive" : s.latest?.status === "SUCCESS" && !s.latest.warnings?.length ? "font-medium text-foreground" : "font-semibold text-amber-700"}>
          {s.source === "edgeai" ? "GitHub/EdgeAI" : "Telegram"}: {s.status}
        </span>
      </p>)}
    </div>
    <div className="mt-2 grid gap-1 border-t border-border/70 pt-2 sm:grid-cols-2">
      {sources.map(s => <p key={`${s.source}-dates`} className="break-words">
        <span className="font-medium text-foreground">{s.source === "edgeai" ? "GitHub/EdgeAI" : "Telegram"}</span>
        {" · "}Rapportdatum {day(s.accepted?.reportDate)}
        {" · "}Marknadsdag SE {day(s.accepted?.dataDates?.SE)} / USA {day(s.accepted?.dataDates?.US)}
        {" · "}Senast lyckad import i sessionen {importTime(s.accepted?.importedAt)}
      </p>)}
    </div>
    {sources.filter(s => s.latest?.status === "FAILED").map(s => <p key={`${s.source}-error`} role="alert" className="mt-1 break-words font-medium text-destructive">
      {s.source === "edgeai" ? "GitHub/EdgeAI" : "Telegram"} · import avvisad: {s.latest?.error || "orsak okänd"}. Tidigare lyckat kvitto används endast som historik.
    </p>)}
    <p data-testid="source-date-alignment" className={alignWarn ? "mt-1 font-semibold text-amber-700" : "mt-1"}>{alignment}</p>
    {verified && completeDates && alignWarn && <p className="mt-1 text-amber-700 dark:text-amber-400">
      Telegram: rapport {day(a!.reportDate)}, data {day(a!.dataDates.SE)} · EdgeAI: rapport {day(b!.reportDate)}, data {day(b!.dataDates.SE)}
    </p>}
    <details className="mt-1">
      <summary className="cursor-pointer select-none hover:text-foreground">Rapportdatum, marknadsdata as-of och importtider</summary>
      <div className="mt-1 space-y-1">
        {sources.map(s => <p key={s.source} className="break-words">
          <span className="font-medium text-foreground">{s.source === "edgeai" ? "GitHub/EdgeAI" : "Telegram"}</span>
          {" · "}{s.latest?.status === "FAILED" && s.accepted ? "Senast lyckad import i sessionen: " : ""}
          Rapportdatum {day(s.accepted?.reportDate)} · Marknadsdag Sverige {day(s.accepted?.dataDates?.SE)} · Marknadsdag USA {day(s.accepted?.dataDates?.US)} · Importerad {importTime(s.accepted?.importedAt)}
          {s.latest?.status === "FAILED" && <> · Avvisat försök {importTime(s.latest.importedAt)}</>}
        </p>)}
        <p>Sparade kvitton för vald session, inte livekontroll av leverans eller kurs. Importtid visas i Stockholmstid. Datum utan verifierat kvitto visas som okända.</p>
      </div>
    </details>
  </div>;
}
