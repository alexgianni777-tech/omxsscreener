import React from "react";
import type { QuoteResult } from "@workspace/api-client-react";
import { PlanGrid } from "./PlanGrid";
import { LiveEntryGuard } from "./LiveEntryGuard";
import { dailySymbol, type DailyPick } from "../lib/dailyCandidates";
import { edgeAiMetrics, type EdgeAICandidateMetrics } from "../lib/edgeAiMetrics";
import { formatPrice } from "../lib/presentationNumbers";
import { quoteLabels, researchQuoteForMarket } from "../lib/researchQuote";

export type ResearchSignal = EdgeAICandidateMetrics & {
  id: number; signalDate?: string | null; entryPrice: number; stopPrice: number; targetPrice: number;
  importWarning?: string | null; volumeAsOf?: string | null; price?: number | null;
};
const WHY: Record<string, string> = {
  MOMENTUM: "Momentum-setup enligt källan", SQUEEZE: "Squeeze/kompression enligt källan",
  STUDS: "Studs-setup enligt källan", WEAKEST: "Svaghet/short-setup enligt källan",
};
const SOURCE: Record<string, string> = { edgeai: "GitHub/EdgeAI", telegram: "Telegram", manual: "Manuell" };
const unknown = "okänd";

export function ResearchCard({ pick, signal, dataDate, quote, warnings = [] }: {
  pick: DailyPick & { decision?: { status?: string | null } }; signal?: ResearchSignal; dataDate: string | null; quote?: QuoteResult; warnings?: readonly string[];
}) {
  // Comparing alternative plans is informational, not proof of a failed import.
  const importWarning = [...new Set([
    ...warnings.filter(w => w.startsWith("Källkonflikt")), signal?.importWarning,
  ].filter(Boolean))].join(" ") || undefined;
  const m = signal ? edgeAiMetrics(signal) : null;
  const checkedQuote = researchQuoteForMarket(pick.market, quote);
  const q = quoteLabels(checkedQuote);
  const long = pick.direction === "LONG";
  return <li data-testid={`research-card-${pick.candidateId}`} className="surface-lift min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <strong className="font-mono text-lg font-semibold tracking-tight">{dailySymbol(pick.ticker)}</strong>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${long ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>{long ? "Long" : "Short"}</span>
      <span aria-label="Screeningstatus" className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {pick.decision?.status ?? unknown} · screening
      </span>
      <span className="text-xs text-muted-foreground">{SOURCE[pick.source] ?? pick.source} · {pick.category}</span>
    </div>
    <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-basis-${pick.candidateId}`}>
      Signal {pick.signalDate ?? unknown} · Datadag D−1 {dataDate ?? unknown}
    </p>
    {warnings.map(w => <p key={w} role="alert" data-testid={`status-research-warning-${pick.candidateId}`} className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700">{w}</p>)}
    <PlanGrid plan={pick} caption="Originalplan · D−1-underlag" />
    <div className="mt-2 flex items-center justify-between gap-3 border-b border-border/70 pb-3 text-xs" data-testid={`holding-${pick.candidateId}`}>
      <span className="text-muted-foreground">Max hålltid</span>
      <span className="font-mono font-medium tabular-nums">{signal?.maxHoldDays != null ? `${signal.maxHoldDays} handelsdagar` : "okänd"}</span>
    </div>
    <div className={q ? "mt-3 rounded-lg bg-muted/40 p-2 text-xs" : "mt-3 text-xs text-muted-foreground"} data-testid={`quote-${pick.candidateId}`}>
      <div className="text-[11px] font-medium text-muted-foreground">{q ? "Aktuell kurs · manuellt hämtad" : "Aktuell kurs · ej hämtad"}</div>
      {q ? <>
        <div className="mt-0.5 font-mono text-sm font-semibold">{q.price}</div>
        <div>{q.asOf}</div>
        <div className="text-muted-foreground">{q.source} · {q.status}</div>
      </> : <div className="mt-0.5 text-muted-foreground">As-of: okänd · ingen kurs hämtad</div>}
    </div>
    <div className="mt-3 text-xs" data-testid={`guard-${pick.candidateId}`}>
    <LiveEntryGuard plan={pick} quote={checkedQuote?.error ? null : checkedQuote ?? null}
        signal={{ signalDate: pick.signalDate, signalSource: pick.source, signalAgeBars: signal?.signalAgeBars, importWarning }} />
    </div>
    <details className="group mt-3 text-xs">
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Motivering, risk och datadetaljer</summary>
      <p className="mt-2 text-sm leading-relaxed text-foreground">{WHY[pick.category] ?? `Setup ${pick.category} enligt källan`}.</p>
      {!q && <p className="mt-2 text-muted-foreground">Inget pris hämtat. Tryck Uppdatera priser och jämför med Avanza.</p>}
      <p className="mt-2 text-muted-foreground">Planerad entry – inte stängningskurs: {formatPrice(pick.entryPrice)}</p>
      {signal?.price != null && <p className="text-muted-foreground">Screeningens referenskurs: {formatPrice(signal.price)} · datadag {dataDate ?? unknown}</p>}
      {m?.isEdgeAI ? <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2" data-testid={`edgeai-metrics-${pick.candidateId}`}>
        <div><dt className="text-muted-foreground">Träff hist.</dt><dd className="font-mono">{m.winRate != null ? `${(m.winRate * 100).toFixed(1)}%` : unknown}</dd></div>
        <div><dt className="text-muted-foreground">Förv. R</dt><dd className="font-mono">{m.expectancyR != null ? `${m.expectancyR.toFixed(2)}R` : unknown}</dd></div>
        <div><dt className="text-muted-foreground">Urval n</dt><dd className="font-mono">{m.sampleN ?? unknown}</dd></div>
        <div><dt className="text-muted-foreground">Ålder</dt><dd className="font-mono">{m.signalAgeBars != null ? `${m.signalAgeBars} st` : unknown}</dd></div>
        <div><dt className="text-muted-foreground">Max håll</dt><dd className="font-mono">{m.maxHoldDays != null ? `${m.maxHoldDays} d` : unknown}</dd></div>
      </dl> : <p className="mt-2 text-muted-foreground">EdgeAI-statistik: {unknown} för denna källa. Ingen validerad edge anges.</p>}
    </details>
    <p className="mt-2 text-[11px] text-muted-foreground">Kurs vid nivå bekräftar inte köp. Eget beslut efter Avanza och ChatGPT.</p>
  </li>;
}
