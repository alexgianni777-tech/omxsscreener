import React from "react";
import { DataFreshness } from "./DataFreshness";
import { PlanGrid } from "./PlanGrid";
import type { SessionSourceReport } from "@workspace/api-client-react";
import { swedishDailyPicks, oldSignalWarning, previousWeekday, dailySymbol, isolatedDailyPick, type DailyPick } from "../lib/dailyCandidates";

type Signal = {
  id: number; ticker: string; market?: string | null; direction: string; signalDate?: string | null;
  volumeAsOf?: string | null; entryPrice: number; stopPrice: number; targetPrice: number;
};
const why: Record<string, string> = {
  MOMENTUM: "Styrka enligt källans momentum-setup", SQUEEZE: "Kompression enligt källans squeeze-setup",
  STUDS: "Studs-setup enligt källrapporten", WEAKEST: "Svaghet/short-setup enligt källrapporten",
};
export function DailyCandidates({ picks, signals, reports = [], sessionDate, preliminary = false, now = new Date() }: {
  picks: readonly DailyPick[]; signals: readonly Signal[]; reports?: readonly SessionSourceReport[];
  sessionDate: string; preliminary?: boolean; now?: Date;
}) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(now);
  return <div data-testid="daily-candidates" className="space-y-3">
    <h3 className="text-lg font-semibold">Dagens kandidater · Sverige</h3>
    {["edgeai", "telegram"].map(source => {
      const latest = [...reports].reverse().find(r => r.source === source && r.status !== "FAILED");
      return latest?.warnings?.length ? <details key={`warning-${source}`} className="text-xs text-amber-600 dark:text-amber-400">
        <summary>{latest.quarantinedIdentities?.length ?? latest.warnings.length} signalidentiteter isolerade ({source}). Övriga giltiga kandidater behålls.</summary>
        {latest.warnings.map(w => <p key={w} className="mt-1">{w}</p>)}
      </details> : null;
    })}
    {["edgeai", "telegram"].map(source => {
      const latest = [...reports].reverse().find(r => r.source === source);
      return latest?.status === "FAILED" ? <p key={source} role="alert" className="text-xs text-red-600 dark:text-red-400">
        Import avvisad ({source}): {latest.error}. Tidigare signaler behålls; inget nytt urval är verifierat från rapporten.</p> : null;
    })}
    <p className="text-xs text-muted-foreground">Högst 3 long och 3 short från befintliga Top 3-förslag. {preliminary && "Preliminärt urval; inte officiell statistik. "}
      Underlag {sessionDate}. Kontrollera aktuell Avanza-kurs och rapportkalender och diskutera med ChatGPT före eget köpbeslut. Ingen position eller order väljs automatiskt.</p>
    <div className="grid gap-3 md:grid-cols-2">{swedishDailyPicks(picks.filter(p => !isolatedDailyPick(p, reports))).map(group => <section key={group.direction} data-testid={`daily-${group.direction}`}>
      <h4 className="mb-2 text-sm font-semibold">{group.direction === "LONG" ? "Long" : "Short"} · {group.picks.length}/3</h4>
      {!group.picks.length && <p className="text-xs text-muted-foreground">Inga förslag i befintligt urval. Inga extra signaler skapas.</p>}
      <ul className="space-y-2">{group.picks.map(p => {
        const candidate = signals.find(c => c.id === p.candidateId && c.signalDate === p.signalDate &&
          c.entryPrice === p.entryPrice && c.stopPrice === p.stopPrice && c.targetPrice === p.targetPrice);
        const matchingReports = reports.filter(r => r.status !== "FAILED" && r.source === p.source && r.signalDate === p.signalDate);
        // Revisions do not yet carry a receipt fingerprint. Never attach the newest
        // report's price date to an older immutable plan just because its day matches.
        const report = matchingReports.length === 1 ? matchingReports[0] : null;
        const conflict = signals.some(c => (c.market ?? "SE") === "SE" && dailySymbol(c.ticker) === dailySymbol(p.ticker) &&
          (c.direction !== p.direction || c.entryPrice !== p.entryPrice || c.stopPrice !== p.stopPrice || c.targetPrice !== p.targetPrice));
        const warnings = [oldSignalWarning(p.signalDate, today),
          conflict ? "Flera planer/riktningar för aktien – jämför innan beslut" : null,
          !report?.dataDates.SE ? "Kursdatadag ej styrkt; volymdatum är inte kurstidpunkt" : null,
          report?.dataDates.SE && report.dataDates.SE !== previousWeekday(today)
            ? "Datadag är inte föregående vardag – verifiera stängningsdag; helgdagar kan förklara." : null,
          matchingReports.length > 1 ? "Flera rapportversioner samma signaldag – planens datadag kan inte kopplas entydigt." : null,
        ].filter(Boolean);
        return <li key={p.candidateId} className="rounded-md border border-border p-3" data-testid={`daily-pick-${p.candidateId}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm"><strong>{dailySymbol(p.ticker)}</strong>
            <span className="font-mono text-[11px] text-muted-foreground">{report?.reportDate ?? p.signalDate ?? "okänd"}</span>
            {warnings.length > 0 && <span data-testid={`status-daily-warn-${p.candidateId}`} className="ml-auto rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
              {conflict ? "Konflikt · " : ""}{warnings.length} varning{warnings.length > 1 ? "ar" : ""}</span>}</div>
          <PlanGrid plan={p} caption="Originalplan · D−1-underlag" />
          <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Visa detaljer</summary>
            <p className="mt-1">{p.source === "edgeai" ? "GitHub/EdgeAI" : p.source === "telegram" ? "Telegram" : p.source} · Rapport {report?.reportDate ?? p.signalDate ?? "okänd"} · Datadag {report?.dataDates.SE ?? "okänd"}
              {candidate?.volumeAsOf && ` · Volymdag ${candidate.volumeAsOf}`}</p>
            <DataFreshness reportDate={report?.reportDate ?? p.signalDate} dataDate={report?.dataDates.SE}
              source={p.source} receiptVerified={report?.status === "SUCCESS"} manual={p.source === "manual"} today={today} />
            {report && <p>Importversion {report.fingerprint.slice(0, 11)}</p>}
            <p className="mt-1">{why[p.category] ?? `Setup ${p.category} enligt källrapporten`}. Ur befintlig Top 3-rankning, inte ett köpbesked.</p>
            {warnings.map(w => <p key={w} className="mt-1 text-amber-600 dark:text-amber-400">{w}</p>)}
          </details>
        </li>;
      })}</ul>
    </section>)}</div>
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">Källhälsa och datumkontroll</summary>
      <p className="mt-2">Föregående vardags stängningsdata behålls. Svensk helgdagskalender är inte verifierad här; kontrollera senaste faktiska börsdag vid helgdagar.</p>
      {["edgeai", "telegram"].map(source => {
        const report = [...reports].reverse().find(r => r.status !== "FAILED" && r.source === source);
        return <p key={source} className="mt-1">{source === "edgeai" ? "GitHub/EdgeAI" : "Telegram"}: {report
          ? `senaste kvitterade import ${new Date(report.importedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}; rapport ${report.reportDate}; importversion ${report.fingerprint.slice(0, 11)}`
          : signals.length ? "Ingen importkvittens för denna session; äldre kandidater bevisar inte aktuell källhälsa." : "Ingen lyckad import registrerad."}</p>;
      })}
      <p className="mt-1">Visar sparade importuppgifter, inte ett nytt tillgänglighetstest. Ingen extra polling.</p>
    </details>
  </div>;
}
