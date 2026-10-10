import React from "react";
export const MANUAL_CATALYSTS = [
  { symbol: "SAM", name: "Boston Beer", date: "2026-10-22", timing: "efter USA-stängning" },
  { symbol: "BUD", name: "AB InBev", date: "2026-10-29", timing: "före USA-öppning" },
  { symbol: "TAP", name: "Molson Coors", date: "2026-11-05", timing: "före USA-öppning" },
  { symbol: "C", name: "Citi", date: "2026-10-13", timing: "tidpunkt ej verifierad" },
  { symbol: "BAC", name: "Bank of America", date: "2026-10-14", timing: "tidpunkt ej verifierad" },
] as const;
export function ManualCatalysts() {
  return <details className="rounded-lg border border-border bg-card p-3 text-xs">
    <summary className="cursor-pointer font-semibold">Manuell rapport-/katalysatorbevakning · inga automatiska köpsignaler</summary>
    <p className="mt-2 text-amber-600">Användarangivna bevakningsdatum, inte automatiskt verifierade. Kontrollera bolagets aktuella rapportdatum,
      tidpunkt och instrumentets handels-/knock-out-status före handel. Ingen ranking eller signal ändras.</p>
    <ul className="mt-2 space-y-1">{MANUAL_CATALYSTS.map(c =>
      <li key={c.symbol}><strong>{c.symbol} · {c.name}</strong> · {c.date} · {c.timing} · manuellt bevakningscase</li>)}</ul>
  </details>;
}
