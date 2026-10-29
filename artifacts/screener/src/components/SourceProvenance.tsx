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
export function SourceProvenance({ reports = [] }: { reports?: readonly SessionSourceReport[] }) {
  const sources = ["telegram", "edgeai"].map(source => {
    const history = reports.filter(r => r.source === source);
    const latest = history.at(-1);
    const accepted = [...history].reverse().find(r => r.status !== "FAILED");
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
  return <div data-testid="source-provenance" className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
    {sources.map(s => <p key={s.source} data-testid={`source-provenance-${s.source}`} className="break-words">
      <span className={s.latest?.status === "FAILED" ? "font-medium text-destructive" : "font-medium text-foreground"}>
        {s.source === "edgeai" ? "GitHub/EdgeAI" : "Telegram"}: {s.status}
      </span>
      {" · "}{s.latest?.status === "FAILED" && s.accepted ? "Senast bevarade: " : ""}
      Rapport {day(s.accepted?.reportDate)} · Marknadsdata as-of {day(s.accepted?.dataDates?.SE)} · Importerad {importTime(s.accepted?.importedAt)}
      {s.latest?.status === "FAILED" && <> · Avvisat försök {importTime(s.latest.importedAt)}</>}
    </p>)}
    <p data-testid="source-date-alignment">{alignment}</p>
    <p>Sparade kvitton för vald session, inte livekontroll av leverans eller kurs. Marknadsdatum avser Sverige; importtid visas i Stockholmstid.</p>
  </div>;
}
