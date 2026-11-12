import { candidateIdentity } from "./candidateSynchronizationPolicy";
import type { ImportReport } from "./importReport";

type Plan = {
  ticker: string; market: string; category: string; direction: string; signalSource?: string;
  signalDate?: string | null; entryPrice: number; stopPrice: number; targetPrice: number; rr: number;
};
/** Different setups can collapse into one legacy bucket. Never choose a conflicting plan by array order. */
export function isolateEdgeAiPlans<T extends Plan>(rows: T[], labels: string[], report: ImportReport): T[] {
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = candidateIdentity(row);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const rejected = new Set<string>();
  const candidateWarnings: NonNullable<ImportReport["candidateWarnings"]> = [];
  const warnings: string[] = [];
  for (const [key, indices] of groups) {
    const first = rows[indices[0]];
    const invalid = indices.some(i => {
      const p = rows[i];
      return ![p.entryPrice, p.stopPrice, p.targetPrice, p.rr].every(n => Number.isFinite(n) && n > 0) ||
        (p.direction === "LONG" ? !(p.stopPrice < p.entryPrice && p.entryPrice < p.targetPrice)
          : !(p.targetPrice < p.entryPrice && p.entryPrice < p.stopPrice));
    });
    const conflict = indices.some(i => ["entryPrice", "stopPrice", "targetPrice", "rr"].some(field =>
      Math.abs((rows[i][field as keyof Plan] as number) - (first[field as keyof Plan] as number)) > 0.005));
    if (invalid || conflict) {
      rejected.add(key);
      const message = `${first.market} ${first.ticker} ${first.direction}/${first.category} isolerad: ${invalid ? "ogiltig riskplan" : "olika setups inom samma signalidentitet"}; ` +
        indices.map(i => `${labels[i] ?? "setup"}: entry ${rows[i].entryPrice}, stop ${rows[i].stopPrice}, target ${rows[i].targetPrice}`).join(" | ") +
        ". Ingen plan valdes; historik bevaras.";
      warnings.push(message);
      candidateWarnings.push({ identity: key, message });
    }
  }
  report.quarantinedIdentities = [...new Set([...(report.quarantinedIdentities ?? []), ...rejected])].sort();
  report.warnings = [...new Set([...(report.warnings ?? []), ...warnings])].sort();
  report.candidateWarnings = candidateWarnings.sort((a, b) => a.identity.localeCompare(b.identity));
  return rows.filter(row => !rejected.has(candidateIdentity(row)));
}
