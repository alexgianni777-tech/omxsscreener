import assert from "node:assert/strict";
import test from "node:test";

import { calculateOpeningGapPct, volumeMultiplierFromQuote } from "./marketIndicators.ts";

test("opening gap is returned in percentage points", () => {
  assert.equal(calculateOpeningGapPct([{ c: 100 }, { o: 102.9 }]), 2.9);
  assert.equal(calculateOpeningGapPct([{ c: 100 }, { o: 97.5 }]), -2.5);
});

test("partial daily volume is not replaced with a different volume metric", () => {
  assert.equal(volumeMultiplierFromQuote({
    regularMarketVolume: 40,
    averageDailyVolume10Day: 1_000,
    averageDailyVolume3Month: 800,
  }), null);
});

test("usable daily relative volume retains its actual ratio", () => {
  assert.equal(volumeMultiplierFromQuote({
    regularMarketVolume: 450,
    averageDailyVolume10Day: 1_000,
    averageDailyVolume3Month: 800,
  }), 0.5);
});