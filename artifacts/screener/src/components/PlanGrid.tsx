import React from "react";
import { formatPrice, formatRR } from "../lib/presentationNumbers";
type P = { entryPrice?: number | null; stopPrice?: number | null; targetPrice?: number | null; rr?: number | null };
export function PlanGrid({ plan, caption, testId }: { plan: P; caption?: string; testId?: string }) {
  const cells: [string, string][] = [["Entry", formatPrice(plan.entryPrice)], ["Stop", formatPrice(plan.stopPrice)],
    ["TP", formatPrice(plan.targetPrice)], ["R/R", formatRR(plan.rr)]];
  return <div className="mt-2" data-testid={testId}>
    {caption && <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{caption}</div>}
    <dl className="grid grid-cols-4 gap-1 rounded-md bg-muted/40 p-1.5">
      {cells.map(([k, v]) => <div key={k} aria-label={`${k} ${v}`} className="min-w-0 text-center">
        <dt className="text-[10px] font-medium text-muted-foreground">{k}</dt>
        <dd className="break-words [overflow-wrap:anywhere] font-mono text-xs font-semibold tabular-nums">{v}</dd>
      </div>)}
    </dl>
  </div>;
}
