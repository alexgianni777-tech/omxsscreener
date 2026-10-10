import test from "node:test";
import assert from "node:assert/strict";
import { executionAnalysis, journalAnalysis } from "./journalAnalysis";
export const execution: any = { id: "real", input: { mode: "REAL", instrumentKind: "SHARE", side: "LONG", entryTime: "2026-10-01T08:00:00Z",
  exitTime: "2026-10-01T09:00:00Z", fillPrice: 100, stopPrice: 95, targetPrice: 110, exitPrice: 110, quantity: 10,
  priceCurrency: "SEK", financingCostKr: 2, commissionKr: 8, spreadCostKr: 4, slippageCostKr: 3 },
  metrics: { riskCashKr: 50, netPnlKr: 90, netR: 1.8 }, signal: { ticker: "TEST", stopPrice: 95, targetPrice: 110 } };
const now = Date.parse("2026-10-02T10:00:00Z");
test("real fills produce gross/net and no double deducted spread/slippage or leverage multiplication", () => {
  const before = JSON.stringify(execution);
  const r = executionAnalysis(execution, now);
  assert.equal(r.grossPnl, 100); assert.equal(r.netPnl, 90); assert.equal(r.netR, 1.8);
  assert.equal(executionAnalysis({ ...execution, input: { ...execution.input, instrumentKind: "PRODUCT", leverage: 20 } }, now).netR, 1.8);
  assert.equal(JSON.stringify(execution), before);
});
test("short fills and explicit FX are signed correctly", () => {
  const short = { ...execution, input: { ...execution.input, side: "SHORT", stopPrice: 105, targetPrice: 90, exitPrice: 90 } };
  assert.equal(executionAnalysis(short, now).netR, 1.8);
  const usd = { ...execution, input: { ...execution.input, priceCurrency: "USD", entryFxSek: 10, exitFxSek: 11 },
    metrics: { riskCashKr: 500, netPnlKr: 2090, netR: 4.18 } };
  assert.equal(executionAnalysis(usd, now).grossPnl, 2100);
  assert.equal(executionAnalysis(usd, now).netR, 4.18);
});
test("missing costs, risk, FX, timestamps or conflicting net evidence never backfill from signals", () => {
  for (const patch of [{ financingCostKr: null }, { commissionKr: null }, { stopPrice: null }, { quantity: null },
    { entryTime: null }, { exitTime: "2026-02-30T09:00:00Z" }, { priceCurrency: "USD" }]) {
    const r = executionAnalysis({ ...execution, input: { ...execution.input, ...patch } }, now);
    assert.equal(r.netR, null);
    assert.ok(r.issues.length);
  }
  const noStop = executionAnalysis({ ...execution, input: { ...execution.input, stopPrice: null } }, now);
  assert.equal(noStop.grossPnl, 100); assert.equal(noStop.netPnl, 90);
  assert.equal(executionAnalysis({ ...execution, metrics: { ...execution.metrics, netPnlKr: 1000 } }, now).netPnl, null);
  assert.equal(executionAnalysis({ ...execution, input: { ...execution.input,
    financingCostKr: Number.MAX_VALUE, commissionKr: Number.MAX_VALUE } }, now).netPnl, null);
});
test("summary excludes simulated/missed/unknown trades, counts flats and computes payoff on the same real net-R cohort", () => {
  const loss = { ...execution, id: "loss", input: { ...execution.input, exitPrice: 95 }, metrics: { riskCashKr: 50, netPnlKr: -60, netR: -1.2 } };
  const flat = { ...execution, id: "flat", input: { ...execution.input, exitPrice: 101 }, metrics: { riskCashKr: 50, netPnlKr: 0, netR: 0 } };
  const records = [execution, loss, flat, { ...execution, id: "sim", input: { ...execution.input, mode: "SIMULATED" } },
    { ...execution, id: "missed", input: { mode: "NOT_TAKEN" } },
    { ...execution, id: "unknown", input: { ...execution.input, commissionKr: null } }];
  const before = JSON.stringify(records), a = journalAnalysis(records, now);
  assert.equal(a.real, 4); assert.equal(a.sample, 3); assert.equal(a.winRate, 1 / 3);
  assert.equal(a.winR, 1.8); assert.equal(a.lossR, -1.2); assert.equal(a.payoff, 1.5);
  assert.equal(a.excluded, 1); assert.equal(a.simulated, 1); assert.equal(a.notTaken, 1);
  assert.equal(JSON.stringify(records), before);
  assert.equal(journalAnalysis([], now).payoff, null);
  assert.equal(journalAnalysis([execution], now).payoff, null);
});
