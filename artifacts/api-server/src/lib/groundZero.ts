export const GROUND_ZERO = {
  label: "AG Invest Ground Zero Day", baseDate: "2026-10-08", baselineSek: 16742,
  observedStartSek: 16736.60, reconciliationDifferenceSek: 5.40,
  goalSek: 100000, targetDate: "2026-12-31",
} as const;

export function amountToOre(value: unknown, signed = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e9 || (!signed && value < 0))
    throw new Error("Ange ett giltigt belopp i SEK.");
  const ore = Math.round(value * 100);
  if (Math.abs(value * 100 - ore) > 0.00001) throw new Error("Belopp får ha högst två decimaler.");
  return ore;
}

export function validateGroundZeroInput(input: { asOfDate: string; totalValueSek: number; netExternalFlowsSek: number | null }, today: string) {
  const d = input.asOfDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(`${d}T12:00:00Z`)) ||
    new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) !== d || d < GROUND_ZERO.baseDate || d > today)
    throw new Error("Avstämningsdatum måste vara ett riktigt datum från Ground Zero till idag.");
  return { asOfDate: d, totalValueOre: amountToOre(input.totalValueSek),
    netExternalFlowsOre: input.netExternalFlowsSek === null ? null : amountToOre(input.netExternalFlowsSek, true) };
}

export function groundZeroSnapshot(row: { id: number; asOfDate: string; createdAt: Date; totalValueOre: number; netExternalFlowsOre: number | null }) {
  const baselineOre = Math.round(GROUND_ZERO.baselineSek * 100);
  const observedOre = Math.round(GROUND_ZERO.observedStartSek * 100);
  const goalOre = Math.round(GROUND_ZERO.goalSek * 100);
  const adjustedOre = row.netExternalFlowsOre === null ? null
    : row.totalValueOre - observedOre - row.netExternalFlowsOre;
  return {
    id: row.id, asOfDate: row.asOfDate, createdAt: row.createdAt.toISOString(),
    totalValueSek: row.totalValueOre / 100, netExternalFlowsSek: row.netExternalFlowsOre === null ? null : row.netExternalFlowsOre / 100,
    rawChangeSek: (row.totalValueOre - baselineOre) / 100,
    adjustedChangeSek: adjustedOre === null ? null : adjustedOre / 100,
    adjustedChangePct: adjustedOre === null ? null : Math.round(adjustedOre / baselineOre * 10000) / 100,
    remainingToGoalSek: Math.max(0, goalOre - row.totalValueOre) / 100,
  };
}
