import test from "node:test";
import assert from "node:assert/strict";
import { parseScreenerText, ScreenerParseError } from "./screenerParser.ts";

const header = [
  "📊 SCREENER · 2026-11-27",
  "MARKNADSVÄDER OMXS30 3305.0 | 5d 2.7% | 1m 1.8% | 3m 8.9% | RSI 79",
  "→ MEDVIND",
  "=== 1 · MOMENTUM — kvalificerade ===",
].join("\n");
const candidate = "1. ABB 100.0 | RS3m 18.5 | 1m 9.4% | RSI 57 | %B 0.90 | ATR 3.3% | vol 1.2x | ↔20dH -0.3%";
const plan = "    plan(LONG): entry ~100.0 · stop 97.00 (1.2×ATR) · mål +1% 105.00 (R/R 1.67) · 1R 103.00";

test("valid underlying-share report parses exactly one candidate", () => {
  const report = parseScreenerText([header, candidate, plan].join("\n"));
  assert.equal(report.date, "2026-11-27");
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].ticker, "ABB");
  assert.equal(report.candidates[0].entryPrice, 100);
  assert.equal(report.candidates[0].stopPrice, 97);
});

test("missing plan fails closed instead of silently dropping a candidate", () => {
  assert.throws(() => parseScreenerText([header, candidate].join("\n")), ScreenerParseError);
});

test("second malformed candidate fails the entire batch rather than partially importing", () => {
  const second = candidate.replace("1. ABB", "2. EPI-A");
  assert.throws(() => parseScreenerText([header, candidate, plan, second, "  plan(LONG): INVALID"].join("\n")), ScreenerParseError);
});

test("invalid exchange-day report is rejected", () => {
  assert.throws(() => parseScreenerText("incomplete report"), ScreenerParseError);
});
