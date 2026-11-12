import assert from "node:assert/strict";
import test from "node:test";
import { calculateProductPnl, countUnderlyingDirections } from "./portfolioSemantics";

test("a rising owned Turbo S product has positive P&L without leverage multiplication", () => {
  const pnl = calculateProductPnl(10, 12, 5, "LONG", "SHORT");
  assert.deepEqual(pnl, { unrealisedKr: 10, unrealisedPct: 20 });
});

test("legacy rows with no product side retain the old direction-based P&L", () => {
  assert.deepEqual(calculateProductPnl(10, 12, 5, null, "SHORT"), {
    unrealisedKr: -10,
    unrealisedPct: -20,
  });
  assert.deepEqual(calculateProductPnl(10, 12, 5, undefined, "LONG"), {
    unrealisedKr: 10,
    unrealisedPct: 20,
  });
});

test("legacy Turbo S labels infer owned product LONG but explicit product SHORT overrides", () => {
  const legacyTurbo = calculateProductPnl(10, 12, 5, null, "SHORT", "TURBO S HEXAGON AVA 32");
  assert.deepEqual(legacyTurbo, { unrealisedKr: 10, unrealisedPct: 20 });

  const explicitShortProduct = calculateProductPnl(10, 12, 5, "SHORT", "SHORT", "TURBO S HEXAGON AVA 32");
  assert.deepEqual(explicitShortProduct, { unrealisedKr: -10, unrealisedPct: -20 });

  const ambiguousMetadata = calculateProductPnl(10, 12, 5, null, "SHORT", "Some custom instrument");
  assert.deepEqual(ambiguousMetadata, { unrealisedKr: -10, unrealisedPct: -20 });
});

test("underlying direction counts preserve unknown legacy instrument semantics", () => {
  assert.deepEqual(countUnderlyingDirections(["SHORT", "LONG", null, undefined]), {
    underlyingLongCount: 1,
    underlyingShortCount: 1,
    underlyingDirectionUnknownCount: 2,
  });
});