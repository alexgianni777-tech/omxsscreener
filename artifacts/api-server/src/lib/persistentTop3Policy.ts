/** Display policy only: never changes screening, ranking or historical inputs. */
export function validDisplayPlan(p: any): boolean {
  const e = p.entryPrice, s = p.stopPrice, t = p.targetPrice;
  return [e, s, t].every(n => typeof n === "number" && Number.isFinite(n) && n > 0) &&
    (p.direction === "LONG" ? s < e && e < t : p.direction === "SHORT" && t < e && e < s);
}
export function validDisplayRevision(r: any, ignoreApproval = false): boolean {
  return !!r && (ignoreApproval || r.displayEligible !== false) && r.available === true &&
    Array.isArray(r.sources) && ["edgeai", "telegram"].every(s => r.sources.includes(s)) &&
    Array.isArray(r.picks) && r.picks.length > 0 && r.picks.every(validDisplayPlan);
}
export function chooseSavedTop3<T extends { date: string; revision: { selectedAt: string } }>(rows: T[]): T | null {
  // No "today"/weekday restriction: weekends and holidays retain the same plan.
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) ||
    b.revision.selectedAt.localeCompare(a.revision.selectedAt))[0] ?? null;
}
