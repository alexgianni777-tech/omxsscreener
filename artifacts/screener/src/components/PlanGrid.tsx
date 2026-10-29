import React from "react";
import { formatPrice, formatRR } from "../lib/presentationNumbers";
type P = { entryPrice?: number | null; stopPrice?: number | null; targetPrice?: number | null; rr?: number | null };
export function PlanGrid({ plan, caption, testId }: { plan: P; caption?: string; testId?: string }) {
  const cells: [string, string][] = [["Entry", formatPrice(plan.entryPrice)], ["Stop", formatPrice(plan.stopPrice)],
    ["TP", formatPrice(plan.targetPrice)], ["R/R", formatRR(plan.rr)]];
  return <div className="mt-3" data-testid={testId}>
    {caption && <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{caption}</div>}
    <dl className="grid grid-cols-4 gap-2 rounded-lg bg-muted/50 px-2 py-2.5">
      {cells.map(([k, v]) => <div key={k} aria-label={`${k} ${v}`} className="min-w-0 text-center">
        <dt className="text-[10px] font-medium text-muted-foreground">{k}</dt>
        <dd className="break-words [overflow-wrap:anywhere] mt-0.5 font-mono text-sm font-semibold tabular-nums">{v}</dd>
      </div>)}
    </dl>
  </div>;
}
