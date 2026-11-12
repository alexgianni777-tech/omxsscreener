import test from "node:test";
import assert from "node:assert/strict";
import { journalMetrics, journalInputKey, type JournalEntryInput } from "./tradeJournal";

export const executed: JournalEntryInput = {
  id: "4f86fc9b-4ebc-4dde-bff4-8c29c6d2f516", candidateId: 1, mode: "REAL",
  instrumentKind: "SHARE", side: "LONG", priceCurrency: "SEK",
  entryTime: "2026-10-01T08:00:00Z", exitTime: "2026-10-01T09:00:00Z",
  fillPrice: 100, stopPrice: 95, targetPrice: 110, exitPrice: 110, quantity: 10,
  leverage: 1, spreadCostKr: 4, slippageCostKr: 3, financingCostKr: 2, commissionKr: 8, notes: "",
};
test("actual fills produce gross and net R, spread and slippage are not deducted twice", () => {
  assert.deepEqual(journalMetrics(executed), { grossR: 2, netR: 1.8, riskCashKr: 50, netPnlKr: 90 });
});
test("SHORT signed return and loss are correct", () => {
  assert.equal(journalMetrics({ ...executed, side: "SHORT", stopPrice: 105, targetPrice: 90, exitPrice: 90 }).grossR, 2);
  assert.equal(journalMetrics({ ...executed, side: "SHORT", stopPrice: 105, targetPrice: 90, exitPrice: 106 }).grossR, -1.2);
});
test("owned leveraged product is valued by its side and fills, never multiplied by leverage", () => {
  assert.deepEqual(journalMetrics({ ...executed, instrumentKind: "PRODUCT", leverage: 10 }), journalMetrics(executed));
});
test("unknown financing or commission keeps net results unknown; explicit zero is known", () => {
  assert.equal(journalMetrics({ ...executed, financingCostKr: null }).netR, null);
  assert.equal(journalMetrics({ ...executed, commissionKr: undefined }).netPnlKr, null);
  assert.equal(journalMetrics({ ...executed, financingCostKr: 0, commissionKr: 0 }).netR, 2);
});
test("USD executions include entry/exit currency effects and SEK costs without mixing units", () => {
  const result = journalMetrics({ ...executed, priceCurrency: "USD", entryFxSek: 10, exitFxSek: 11 });
  assert.equal(result.riskCashKr, 500);
  assert.equal(result.grossR, 4.2);
  assert.equal(result.netR, 4.18);
  assert.throws(() => journalMetrics({ ...executed, priceCurrency: "USD" }), /USD/);
});
test("simulated executions stay explicit; missed trades have no synthetic R", () => {
  assert.equal(journalMetrics({ ...executed, mode: "SIMULATED" }).grossR, 2);
  assert.deepEqual(journalMetrics({ id: executed.id, candidateId: 1, mode: "NOT_TAKEN", notes: "Missad entry" }),
    { grossR: null, netR: null, riskCashKr: null, netPnlKr: null });
  assert.throws(() => journalMetrics({ ...executed, mode: "NOT_TAKEN", notes: "missed" }), /utebliven/);
  assert.throws(() => journalMetrics({ id: executed.id, candidateId: 1, mode: "NOT_TAKEN", notes: "" }), /varför/);
});
test("keeps genuinely executed late/broken-plan trades instead of excluding them from the journal", () => {
  assert.equal(journalMetrics({ ...executed, targetPrice: 95 }).grossR, 2);
  const broken = journalMetrics({ ...executed, stopPrice: 100 });
  assert.equal(broken.riskCashKr, null);
  assert.equal(broken.grossR, null);
  assert.equal(broken.netR, null);
  assert.equal(broken.netPnlKr, 90);
});
test("rejects impossible/future/unzoned timestamps, fractional identity and invalid values", () => {
  for (const extra of [
    { candidateId: 1.5 }, { entryTime: "2026-02-30T08:00:00Z" }, { entryTime: "2026-10-01T08:00:00" },
    { exitTime: "2099-01-01T08:00:00Z" }, { exitTime: "2026-10-01T07:00:00Z" },
    { financingCostKr: -1 }, { quantity: 0 }, { leverage: 0 },
    { priceCurrency: undefined },
  ]) assert.throws(() => journalMetrics({ ...executed, ...extra }));
});
test("inputs remain immutable and retry keys are insensitive to JSON order and omitted nulls", () => {
  const input = Object.freeze({ ...executed });
  const before = JSON.stringify(input);
  journalMetrics(input);
  assert.equal(JSON.stringify(input), before);
  const reverse = Object.fromEntries(Object.entries(input).reverse()) as JournalEntryInput;
  assert.equal(journalInputKey(input), journalInputKey(reverse));
  assert.equal(journalInputKey({ ...input, entryFxSek: null }), journalInputKey(input));
});
