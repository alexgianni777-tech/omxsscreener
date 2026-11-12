import React from "react";
import { formatPrice, formatRR } from "../lib/presentationNumbers";

type Props = {
  plan: { entryPrice: number; stopPrice: number; targetPrice: number; rr: number };
  entryGapPct: number | null;
  stopPct: number | null;
  targetPct: number;
};

/** Display-only: percentages are supplied by the existing session calculations. */
export function SessionTradePlan({ plan, entryGapPct, stopPct, targetPct }: Props) {
  return (
    <div data-testid="session-trade-plan"
      className="col-span-full grid min-w-0 gap-3 rounded-md bg-muted/30 p-3"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 7rem), 1fr))" }}>
      <div className="min-w-0 break-words">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Entry</div>
        <div className="font-mono text-base font-semibold tabular-nums">{formatPrice(plan.entryPrice)}</div>
        {entryGapPct != null && <div className={`mt-0.5 font-mono text-[10px] ${Math.abs(entryGapPct) < 0.3 ? "text-success" : "text-muted-foreground"}`}>
          {entryGapPct >= 0 ? "+" : ""}{entryGapPct.toFixed(1)}% fr. nu
        </div>}
      </div>
      <div className="min-w-0 break-words">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Stop</div>
        <div className="font-mono text-base font-semibold tabular-nums text-destructive">{formatPrice(plan.stopPrice)}</div>
        {stopPct != null && <div className="mt-0.5 font-mono text-[10px] text-destructive">−{stopPct.toFixed(1)}% fr. entry</div>}
      </div>
      <div className="min-w-0 break-words">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Mål / TP</div>
        <div className="font-mono text-base font-semibold tabular-nums text-success">{formatPrice(plan.targetPrice)}</div>
        {targetPct > 0 && <div className="mt-0.5 font-mono text-[10px] text-success">+{targetPct.toFixed(1)}% fr. entry</div>}
      </div>
      <div className="min-w-0 break-words">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">R/R</div>
        <div className="font-mono text-base font-bold tabular-nums">{formatRR(plan.rr)}R</div>
      </div>
    </div>
  );
}
