import React from "react";
import { d1Freshness } from "@workspace/market-calendar";
import type { SessionSourceReport } from "@workspace/api-client-react";
import { marketDailyPicks, oldSignalWarning, type DailyPick } from "../lib/dailyCandidates";
import { filterActiveOmxs30Picks } from "../lib/omxs30ActiveView";

export type MarketEvidenceSignal = {
  market?: string | null; direction?: string; signalDate?: string | null;
};
const validDay = (value?: string | null): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

/** Describe existing evidence only. Does not select candidates or relax eligibility. */
export function marketEvidence(market: "SE" | "US", direction: string,
  signals: readonly MarketEvidenceSignal[], reports: readonly SessionSourceReport[], sessionDate: string) {
  const rows = signals.filter(s => s.market === market && s.direction === direction);
  const dates = rows.map(s => s.signalDate).filter(validDay).sort();
  const receipts = reports.filter(r => r.source === "edgeai" && r.status === "SUCCESS")
    .slice().sort((a, b) => (a.importedAt ?? "").localeCompare(b.importedAt ?? ""));
  const receipt = receipts.at(-1);
  const dataDate = receipt?.dataDates?.[market] ?? null;
  const blockedDates = rows.filter(s => !validDay(s.signalDate) ||
    !validDay(sessionDate) || oldSignalWarning(s.signalDate, sessionDate, market) != null).length;
  const staleData = d1Freshness(dataDate, sessionDate, market).status === "STALE";
  const futureData = validDay(sessionDate) && validDay(dataDate) && dataDate > sessionDate;
  return { count: rows.length, newestSignal: dates.at(-1) ?? null, blockedDates,
    dataDate: validDay(dataDate) ? dataDate : null, reportDate: receipt?.reportDate ?? null,
    staleData, futureData };
}

/** Active research is OMXS30-only; out-of-scope rows remain available in session history. */
export function ResearchMarketSections({ picks, signals = [], reports = [], sessionDate, decisionDate = sessionDate, renderPick, omxs30Only = true }: {
  picks: readonly DailyPick[]; signals?: readonly MarketEvidenceSignal[];
  reports?: readonly SessionSourceReport[]; sessionDate: string; decisionDate?: string;
  renderPick: (pick: DailyPick) => React.ReactNode;
  omxs30Only?: boolean;
}) {
  const activePicks = omxs30Only ? filterActiveOmxs30Picks(picks, decisionDate) : [...picks];
  return <><nav aria-label="OMXS30-signalgrupper" className="mt-4 flex flex-wrap gap-2 text-sm font-medium">
    <a href="#research-SE-LONG" className="rounded-lg bg-muted px-3 py-2 hover:bg-muted/70">OMXS30 · Köp / Long</a>
    <a href="#research-SE-SHORT" className="rounded-lg bg-muted px-3 py-2 hover:bg-muted/70">OMXS30 · Sälj / Short</a>
  </nav><div className="mt-5 grid min-w-0 gap-6">
    <section id="research-market-SE" className="min-w-0 scroll-mt-4" data-testid="research-market-SE">
      <h3 className="mb-3 border-b border-border pb-2 text-base font-semibold">OMXS30 · Sverige</h3>
      <div className="space-y-5">
        {marketDailyPicks(activePicks, "SE").map(group => {
          const evidence = marketEvidence("SE", group.direction, signals, reports, sessionDate);
          return <section id={`research-SE-${group.direction}`} key={group.direction} className="min-w-0" data-testid={`research-SE-${group.direction}`}>
            <h4 className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
              <span>Topp 3 {group.direction === "LONG" ? "Köp / Long" : "Sälj / Short"}</span>
              <span className="font-mono text-xs font-normal text-muted-foreground">{group.picks.length}/3</span>
            </h4>
            <p className="mb-2 break-words text-xs leading-relaxed text-muted-foreground">
              Senast inläst · EdgeAI-marknadsdag: <strong>{evidence.dataDate ?? "okänd"}</strong>
              {" · "}Rapportdag: {evidence.reportDate ?? "okänd"}
              {" · "}Senaste signaldatum: {evidence.newestSignal ?? "saknas"}.
            </p>
            {!group.picks.length && <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed" data-testid={`empty-SE-${group.direction}`}>
              <p className="font-medium">Inga giltiga förslag i visat urval · NO TRADE.</p>
              <p>Kontrollerad mot inläst session {sessionDate || "okänd"}: {evidence.count} importerade screeningcase,
                {" "}{evidence.blockedDates} med för gammalt, framtida eller okänt signaldatum.</p>
              {evidence.blockedDates > 0 && <p className="font-medium text-amber-700 dark:text-amber-400">
                Datumspärr: endast sessionens dag eller föregående handelsdag accepteras. En ny importtid förnyar inte signalen.
              </p>}
              {evidence.staleData && <p className="font-medium text-amber-700 dark:text-amber-400">STALE · marknadsdata är äldre än föregående handelsdag. Inget datum flyttas fram.</p>}
              {evidence.futureData && <p className="font-medium text-destructive">CONFLICT · marknadsdatum ligger efter sessionen.</p>}
              {!evidence.dataDate && <p className="text-muted-foreground">NO DATA · verifierat marknadsdatum saknas.</p>}
              {evidence.count > evidence.blockedDates && <p className="text-muted-foreground">
                Ett godkänt signaldatum räcker inte: sparat urval, källkrav, risk- och konfliktkontroller måste också vara uppfyllda. Se sessionens beslut för enskilda case.
              </p>}
              <p className="text-muted-foreground">Endast daterat OMXS30-medlemskap och verifierat svenskt marknadsunderlag får visas aktivt; äldre eller utanför-index-case ligger kvar i sessionens historik.</p>
            </div>}
            <ul className="space-y-3">{group.picks.map(renderPick)}</ul>
          </section>;
        })}
      </div>
    </section>
  </div></>;
}
