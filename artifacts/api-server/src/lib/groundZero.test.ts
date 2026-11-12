import test from "node:test";
import assert from "node:assert/strict";
import { GROUND_ZERO, groundZeroSnapshot, validateGroundZeroInput, amountToOre } from "./groundZero";

const snapshot = (value: number, flows: number | null) => groundZeroSnapshot({
  id: 1, asOfDate: "2026-10-08", createdAt: new Date("2026-10-08T09:00:00Z"),
  totalValueOre: amountToOre(value), netExternalFlowsOre: flows === null ? null : amountToOre(flows, true),
});
test("official benchmark and observed balance remain separate; 5.40 reconciliation is not profit", () => {
  assert.equal(GROUND_ZERO.baselineSek, 16742);
  assert.equal(GROUND_ZERO.goalSek, 100000);
  assert.equal(GROUND_ZERO.targetDate, "2026-12-31");
  const s = snapshot(16736.60, 0);
  assert.equal(s.rawChangeSek, -5.40);
  assert.equal(s.adjustedChangeSek, 0);
  assert.equal(s.adjustedChangePct, 0);
  assert.equal(s.remainingToGoalSek, 83263.40);
});
test("cumulative deposits/withdrawals are not returns; unknown flows do not become guessed zero", () => {
  assert.equal(snapshot(17736.60, 1000).adjustedChangeSek, 0);
  assert.equal(snapshot(15736.60, -1000).adjustedChangeSek, 0);
  assert.equal(snapshot(17836.60, 1000).adjustedChangeSek, 100);
  assert.equal(snapshot(17836.60, 1000).adjustedChangePct, 0.60);
  assert.equal(snapshot(17736.60, null).adjustedChangeSek, null);
  assert.equal(snapshot(17736.60, null).adjustedChangePct, null);
  assert.equal(snapshot(100001, 0).remainingToGoalSek, 0);
});
test("validate exact cents, sign, date bounds and impossible dates without modifying input", () => {
  const input = { asOfDate: "2026-10-08", totalValueSek: 16736.60, netExternalFlowsSek: null };
  assert.equal(validateGroundZeroInput(input, "2026-10-08").totalValueOre, 1673660);
  assert.equal(input.netExternalFlowsSek, null);
  for (const date of ["2026-10-07", "2026-10-09", "2026-02-30", "bad"])
    assert.throws(() => validateGroundZeroInput({ ...input, asOfDate: date }, "2026-10-08"));
  for (const amount of [-1, NaN, Infinity, 10.005]) assert.throws(() => amountToOre(amount));
});
