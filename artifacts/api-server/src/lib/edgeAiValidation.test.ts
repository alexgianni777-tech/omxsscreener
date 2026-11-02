import assert from "node:assert/strict";
import test from "node:test";
import { validateEdgeAiPayload } from "./edgeAiValidation";

const validSetup = {
  ticker: "TEST",
  setup: "Momentum",
  dir: "long",
  entry: 100,
  stop: 95,
  target: 110,
  signalT: "2026-10-02T14:00:00Z",
  barsAgo: 1,
  rs: 0.2,
  edge: { winRate: 55, expectancyR: 0.35, sample: 20 },
};

const payload = (setups: unknown[] = [validSetup]) => ({
  generatedAt: "2026-10-02T16:00:00Z",
  markets: {
    SE: { dataAsOf: "2026-10-01", setups },
    US: { dataAsOf: "2026-10-01", setups: [] },
  },
});

test("accepts the current envelope shape with separate SE/US D-1 dates and valid plans", () => {
  const quality = validateEdgeAiPayload(payload(), "2026-10-02");
  assert.deepEqual(quality.errors, []);
  assert.equal(quality.dataDates.SE, "2026-10-01");
  assert.equal(quality.dataDates.US, "2026-10-01");
});

test("missing or invalid direction, levels, edge, and signal timezone are quarantined, never defaulted", () => {
  const invalid = { ...validSetup, dir: undefined, entry: undefined, signalT: "2026-10-02T14:00:00" };
  const quality = validateEdgeAiPayload(payload([invalid]), "2026-10-02");
  assert.equal(quality.errors.length, 1);
  assert.match(quality.errors[0], /riktning/);
  assert.match(quality.errors[0], /entry/);
  assert.match(quality.errors[0], /signalT/);
  assert.equal(quality.quarantinedIdentities.length, 1);
});

test("rejects missing markets and inconsistent/future market dates", () => {
  const noMarkets = validateEdgeAiPayload({ generatedAt: "2026-10-02T16:00:00Z" }, "2026-10-02");
  assert.ok(noMarkets.errors.some(error => error.includes("markets saknas")));
  const partialMarkets = validateEdgeAiPayload({
    generatedAt: "2026-10-02T16:00:00Z",
    markets: { SE: { dataAsOf: "2026-10-01", setups: [] } },
  }, "2026-10-02");
  assert.ok(partialMarkets.errors.some(error => error.includes("markets.US saknas")));
  const future = validateEdgeAiPayload({
    ...payload(),
    markets: { SE: { dataAsOf: "2026-10-03", setups: [validSetup] }, US: { dataAsOf: null, setups: [] } },
  }, "2026-10-02");
  assert.ok(future.errors.some(error => error.includes("efter rapportdagen")));
  assert.equal(future.dataDates.SE, null);
});

test("a zero historical sample warns instead of claiming established edge", () => {
  const quality = validateEdgeAiPayload(payload([{ ...validSetup, edge: { winRate: 0, expectancyR: 0, sample: 0 } }]), "2026-10-02");
  assert.deepEqual(quality.errors, []);
  assert.ok(quality.warnings.some(warning => warning.includes("sample size is 0")));
});
