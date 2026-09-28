import assert from "node:assert/strict";
import test from "node:test";

import { parseScreenerText, ScreenerParseError } from "./screenerParser.ts";

const header = `SCREENER · 2025-03-14
MARKNADSVÄDER  OMXS30 3305.0 | 5d 2.7% | 1m 1.8% | 3m 8.9% | RSI 79
→ MEDVIND
=== 1 · MOMENTUM — starkast ===`;

const validCandidate = `1. SSAB 102.85 | RS3m 18.5 | 1m 9.4% | RSI 57 | %B 0.90 | ATR 3.3% | vol 0.2x | ↔20dH -0.3%
plan(LONG): entry ~102.85 · stop 98.83 (1.2×ATR) · mål +1% 103.88 (R/R 0.26) · 1R 106.87`;

test("parses a valid candidate while ignoring harmless numbered prose", () => {
  const parsed = parseScreenerText(`${header}
1. MOMENTUM OVERVIEW
${validCandidate}`);

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].ticker, "SSAB");
  assert.equal(parsed.candidates[0].category, "MOMENTUM");
});

test("fails the whole parse when a candidate among valid rows is malformed", () => {
  const malformedCandidate = `2. VOLVO B 250.00 | broken candidate data
plan(LONG): entry ~250.00 · stop 240.00 · mål 275.00 (R/R 2.50)`;

  assert.throws(
    () => parseScreenerText(`${header}
${validCandidate}
${malformedCandidate}`),
    (error: unknown) => {
      assert.ok(error instanceof ScreenerParseError);
      assert.match(error.message, /Line \d+ \(VOLVO\)/);
      assert.match(error.message, /Could not parse candidate data line/);
      return true;
    },
  );
});

test("fails with an actionable error when a candidate has no plan", () => {
  assert.throws(
    () => parseScreenerText(`${header}
1. SSAB 102.85 | incomplete row`),
    (error: unknown) => {
      assert.ok(error instanceof ScreenerParseError);
      assert.match(error.message, /Line \d+ \(SSAB\)/);
      assert.match(error.message, /missing its plan line/);
      return true;
    },
  );
});