import assert from "node:assert/strict";
import test from "node:test";

import { resolveTradePerformance, type TradePerformanceInput } from "./tradePerformance.ts";

const trade = (overrides: Partial<TradePerformanceInput> = {}): TradePerformanceInput => ({
  outcome: "TIME_EXIT",
  realizedR: null,
  exitPrice: null,
  entryPrice: 100,
  stopPrice: 90,
  direction: "LONG",
  resolutionEntryPrice: null,
  resolutionStopPrice: null,
  resolutionDirection: null,
  ...overrides,
});

test("TIME_EXIT classifies positive, negative, and zero realized R by sign", () => {
  assert.deepEqual(resolveTradePerformance(trade({ realizedR: 1.25 })), { r: 1.25, result: "WIN" });
  assert.deepEqual(resolveTradePerformance(trade({ realizedR: -0.5 })), { r: -0.5, result: "LOSS" });
  assert.deepEqual(resolveTradePerformance(trade({ realizedR: 0 })), { r: 0, result: "FLAT" });
});

test("persisted realized R is usable without an exit price", () => {
  assert.deepEqual(
    resolveTradePerformance(trade({ outcome: "WIN", realizedR: 0.75 })),
    { r: 0.75, result: "WIN" },
  );
});

test("WIN and LOSS with malformed realized-R signs are excluded", () => {
  assert.equal(resolveTradePerformance(trade({ outcome: "WIN", realizedR: -1 })), null);
  assert.equal(resolveTradePerformance(trade({ outcome: "LOSS", realizedR: 0 })), null);
});

test("legacy exits are calculated using saved resolution levels and direction", () => {
  assert.deepEqual(
    resolveTradePerformance(trade({
      outcome: "LOSS",
      exitPrice: 105,
      resolutionEntryPrice: 100,
      resolutionStopPrice: 110,
      resolutionDirection: "SHORT",
    })),
    { r: -0.5, result: "LOSS" },
  );
});

test("saved resolution levels remain usable when current plan prices are missing", () => {
  assert.deepEqual(
    resolveTradePerformance(trade({
      outcome: "WIN",
      exitPrice: 110,
      entryPrice: null,
      stopPrice: null,
      resolutionEntryPrice: 100,
      resolutionStopPrice: 90,
      resolutionDirection: "LONG",
    })),
    { r: 1, result: "WIN" },
  );
});

test("legacy outcomes without a reconstructable exit and risk unit stay unresolved", () => {
  assert.equal(resolveTradePerformance(trade({ outcome: "WIN" })), null);
  assert.equal(resolveTradePerformance(trade({ exitPrice: 100, stopPrice: 100 })), null);
});