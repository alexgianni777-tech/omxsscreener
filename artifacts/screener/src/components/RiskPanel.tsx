import React from "react";
type Plan = { direction: string; entryPrice: number; stopPrice: number; targetPrice: number };
export function riskInR(p: Plan) {
  const valid = [p.entryPrice, p.stopPrice, p.targetPrice].every(n => Number.isFinite(n) && n > 0) &&
    (p.direction === "LONG" ? p.stopPrice < p.entryPrice && p.entryPrice < p.targetPrice
      : p.direction === "SHORT" && p.targetPrice < p.entryPrice && p.entryPrice < p.stopPrice);
  if (!valid) return null;
  const risk = Math.abs(p.entryPrice - p.stopPrice);
  return { risk, rewardR: Math.abs(p.targetPrice - p.entryPrice) / risk };
}
export function RiskPanel({ plan, instrument = "UNDERLYING", netR, realizedR }: {
  plan: Plan; instrument?: "UNDERLYING" | "SHARE" | "PRODUCT"; netR?: number | null; realizedR?: number | null;
}) {
  const r = riskInR(plan);
  return <details className="mt-2 rounded border border-border p-2 text-xs" data-testid="risk-panel">
    <summary className="cursor-pointer">R/risk · {instrument === "PRODUCT" ? "handlat instrument" : instrument === "SHARE" ? "handlad aktie" : "underliggande aktiesignal"}
      {" "}· 1R = {r?.risk.toFixed(2) ?? "okänd"} prisenheter · planerat R:R {r?.rewardR.toFixed(2) ?? "okänt"}</summary>
    <p className="mt-2 font-mono">Entry/fill {plan.entryPrice} · Stop/invalidation {plan.stopPrice} · Target {plan.targetPrice}</p>
    <p>Initial prisrisk = |entry − stop| = {r?.risk.toFixed(2) ?? "okänd"} = {r ? "1R" : "okänt R"}.
      {" "}Target motsvarar {r?.rewardR.toFixed(2) ?? "okänt"}R. Kostnader ingår inte i planerat R:R.</p>
    <p>Realiserad netto-R: {netR != null && Number.isFinite(netR) ? `${netR.toFixed(2)}R` : "okänd / kostnader ej verifierade"}.
      {realizedR != null && Number.isFinite(realizedR) ? ` Separat registrerat signalutfall: ${realizedR.toFixed(2)}R; inte verifierad nettoavkastning.` : ""}</p>
    <p className="mt-1 text-amber-600">Underliggandens risk är inte produktens risk. För mini futures garanteras inte stop/exitnivån:
      gap, spread, finansiering och knock-out kan ge annan eller total förlust. Kontrollera aktuell instrumentstatus.</p>
  </details>;
}
