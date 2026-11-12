import { formatPrice, formatRR } from "../lib/presentationNumbers";
import React from "react";
import { netRiskReward, type CostEvidence } from "../lib/riskCostPlan";
type Plan = { direction: string; entryPrice: number; stopPrice: number; targetPrice: number };
export function riskInR(p: Plan) {
  const valid = [p.entryPrice, p.stopPrice, p.targetPrice].every(n => Number.isFinite(n) && n > 0) &&
    (p.direction === "LONG" ? p.stopPrice < p.entryPrice && p.entryPrice < p.targetPrice
      : p.direction === "SHORT" && p.targetPrice < p.entryPrice && p.entryPrice < p.stopPrice);
  if (!valid) return null;
  const risk = Math.abs(p.entryPrice - p.stopPrice);
  return { risk, rewardR: Math.abs(p.targetPrice - p.entryPrice) / risk };
}
export function RiskPanel({ plan, instrument = "UNDERLYING", netR, realizedR, costEvidence }: {
  plan: Plan; instrument?: "UNDERLYING" | "SHARE" | "PRODUCT"; netR?: number | null; realizedR?: number | null; costEvidence?:CostEvidence;
}) {
  const r = riskInR(plan);
  return <details className="col-span-full mt-2 min-w-0 rounded border border-border p-2 text-xs break-words" data-testid="risk-panel">
    <summary className="cursor-pointer">R/risk · {instrument === "PRODUCT" ? "handlat instrument" : instrument === "SHARE" ? "handlad aktie" : "underliggande aktiesignal"}
      {" "}· 1R = {formatPrice(r?.risk)} prisenheter · planerat R:R {formatRR(r?.rewardR)}</summary>
    <p className="mt-2 font-mono">Entry/fill {formatPrice(plan.entryPrice)} · Stop/invalidation {formatPrice(plan.stopPrice)} · Target {formatPrice(plan.targetPrice)}</p>
    <p>Initial prisrisk = |entry − stop| = {formatPrice(r?.risk)} = {r ? "1R" : "okänt R"}.
      {" "}Target motsvarar {formatRR(r?.rewardR)}R. Kostnader ingår inte i planerat R:R.</p>
    <p>Realiserad netto-R: {netR != null && Number.isFinite(netR) ? `${netR.toFixed(2)}R` : "okänd / kostnader ej verifierade"}.
      {realizedR != null && Number.isFinite(realizedR) ? ` Separat registrerat signalutfall: ${realizedR.toFixed(2)}R; inte verifierad nettoavkastning.` : ""}</p>
    <p className="mt-1 text-amber-600">Underliggandens risk är inte produktens risk. För mini futures garanteras inte stop/exitnivån:
      gap, spread, finansiering och knock-out kan ge annan eller total förlust. Kontrollera aktuell instrumentstatus.</p>
    <p>{netRiskReward(costEvidence)==null?"Netto-R/R kan inte verifieras":`Scenario netto-R/R ${formatRR(netRiskReward(costEvidence))} – inte garanterat utfall`}.
      Kräver produktens aktuella spread, courtage, FX, funding och verifierade kontrakts-/hävstångsvillkor.
      Detta är inte samma sak som realiserad netto-R ovan.</p>
    <p>Riskpolicy: max 20 % insats och max 4 % portföljrisk; 0,5–1 % är ett försiktighetsexempel.
      Utan verifierat kontokapital och maximal förlust är gränserna inte verifierade. Stop är ingen garanti mot gap/knockout.</p>
  </details>;
}
