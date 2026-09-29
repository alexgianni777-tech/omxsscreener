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

test("parses mixed-case company names and ignores numbered footer instructions", () => {
  const parsed = parseScreenerText(`${header}
1. SCA 122.25 | RS3m 22.3 | 1m 7.6% | RSI 69 | %B 0.73 | ATR 1.7% | vol 0.6x | ↔20dH -3.7%
plan(LONG): entry ~122.25 · stop 119.70 (1.2×ATR) · mål 126.50 (2×ATR, R/R 1.67) · max 10 dagar
2. Swedbank 411.00 | RS3m 11.8 | 1m 9.3% | RSI 72 | %B 0.83 | ATR 1.9% | vol 1.4x | ↔20dH -1.2%
plan(LONG): entry ~411.00 · stop 401.86 (1.2×ATR) · mål 426.23 (2×ATR, R/R 1.67) · max 10 dagar
3. Alfa Laval 500.00 | RS3m 10.0 | 1m 3.0% | RSI 55 | %B 0.50 | ATR 2.0% | vol 1.1x | ↔20dH -1.0%
plan(LONG): entry ~500.00 · stop 488.00 (1.2×ATR) · mål 520.00 (2×ATR, R/R 1.67) · max 10 dagar
(Loggade 3 kandidater.)
DIN DEL AV JOBBET:
4. LOGGA varje trade (setup, val, utfall). Efter 20–30 trades: mät resultat.`);

  assert.deepEqual(parsed.candidates.map((candidate) => candidate.ticker), ["SCA", "Swedbank", "Alfa Laval"]);
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