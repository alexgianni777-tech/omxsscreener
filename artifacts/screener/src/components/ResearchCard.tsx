import React from "react";
import type { QuoteResult } from "@workspace/api-client-react";
import { PlanGrid } from "./PlanGrid";
import { LiveEntryGuard } from "./LiveEntryGuard";
import { dailySymbol, type DailyPick } from "../lib/dailyCandidates";
import { edgeAiMetrics, type EdgeAICandidateMetrics } from "../lib/edgeAiMetrics";
import { formatPrice } from "../lib/presentationNumbers";
import { quoteLabels } from "../lib/researchQuote";

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
  pick: DailyPick; signal?: ResearchSignal; dataDate: string | null; quote?: QuoteResult; warnings?: readonly string[];
}) {
  const importWarning = warnings.length ? warnings.join(" ") : signal?.importWarning;
  const m = signal ? edgeAiMetrics(signal) : null;
  const q = quoteLabels(quote);
  const long = pick.direction === "LONG";
  return <li data-testid={`research-card-${pick.candidateId}`} className="min-w-0 rounded-md border border-border bg-background/70 p-3">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <strong className="font-mono text-base">{dailySymbol(pick.ticker)}</strong>
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${long ? "text-success" : "text-destructive"}`}>{long ? "Long" : "Short"}</span>
      <span className="text-xs text-muted-foreground">{SOURCE[pick.source] ?? pick.source} · {pick.category}</span>
    </div>
    <p className="mt-1 text-[11px] text-muted-foreground" data-testid={`text-basis-${pick.candidateId}`}>
      Signal {pick.signalDate ?? unknown} · Datadag D−1 {dataDate ?? unknown}
    </p>
    {warnings.map(w => <p key={w} role="alert" data-testid={`status-research-warning-${pick.candidateId}`} className="mt-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">{w}</p>)}
    <p className="mt-1 text-xs">{WHY[pick.category] ?? `Setup ${pick.category} enligt källan`}.</p>
    {m?.isEdgeAI ? <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[11px]" data-testid={`edgeai-metrics-${pick.candidateId}`}>
      <div><dt className="text-muted-foreground">Träff hist.</dt><dd className="font-mono">{m.winRate != null ? `${(m.winRate * 100).toFixed(1)}%` : unknown}</dd></div>
      <div><dt className="text-muted-foreground">Förv. R</dt><dd className="font-mono">{m.expectancyR != null ? `${m.expectancyR.toFixed(2)}R` : unknown}</dd></div>
      <div><dt className="text-muted-foreground">Urval n</dt><dd className="font-mono">{m.sampleN ?? unknown}</dd></div>
      <div><dt className="text-muted-foreground">Ålder</dt><dd className="font-mono">{m.signalAgeBars != null ? `${m.signalAgeBars} st` : unknown}</dd></div>
      <div><dt className="text-muted-foreground">Max håll</dt><dd className="font-mono">{m.maxHoldDays != null ? `${m.maxHoldDays} d` : unknown}</dd></div>
    </dl> : <p className="mt-1 text-[11px] text-muted-foreground">EdgeAI-statistik: {unknown} för denna källa. Ingen validerad edge anges.</p>}
    <PlanGrid plan={pick} caption="Originalplan · D−1-underlag" />
    <div className="mt-2 rounded-md border border-dashed border-border p-2 text-[11px]" data-testid={`quote-${pick.candidateId}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Aktuell kurs · manuellt hämtad</div>
      {q ? <>
        <div className="font-mono text-sm font-semibold">{q.price}</div>
        <div>{q.asOf}</div>
        <div className="text-muted-foreground">{q.source} · {q.status}</div>
      </> : <div className="text-muted-foreground">Inget pris hämtat. Tryck Uppdatera priser och jämför med Avanza.</div>}
      <div className="mt-1 text-muted-foreground">Planerad entry – inte stängningskurs: {formatPrice(pick.entryPrice)}</div>
      {signal?.price != null && <div className="text-muted-foreground">Screeningens referenskurs: {formatPrice(signal.price)} · datadag {dataDate ?? unknown}</div>}
    </div>
    <div className="mt-2 text-xs" data-testid={`guard-${pick.candidateId}`}>
      <LiveEntryGuard plan={pick} quote={quote ?? null}
        signal={{ signalDate: pick.signalDate, signalSource: pick.source, signalAgeBars: signal?.signalAgeBars, importWarning }} />
    </div>
    <p className="mt-1 text-[10px] text-muted-foreground">Kurs vid nivå bekräftar inte köp. Eget beslut efter Avanza och ChatGPT.</p>
  </li>;
}
