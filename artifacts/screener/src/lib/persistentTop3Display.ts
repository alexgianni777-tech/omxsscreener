import type { Top3Revision } from "@workspace/api-client-react";

export function savedRevision(r: Top3Revision) {
  return r.displayEligible !== false && r.available && r.picks.length > 0 &&
    ["edgeai", "telegram"].every(s => r.sources.includes(s)) &&
    r.picks.every(p => [p.entryPrice, p.stopPrice, p.targetPrice].every(n => Number.isFinite(n) && n > 0) &&
      (p.direction === "LONG" ? p.stopPrice < p.entryPrice && p.entryPrice < p.targetPrice
        : p.direction === "SHORT" && p.targetPrice < p.entryPrice && p.entryPrice < p.stopPrice));
}
export function currentSavedRevision(rows: Top3Revision[]) {
  return [...rows].sort((a, b) => b.revision - a.revision).find(savedRevision);
}
export function stockholmToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
}
