import assert from "node:assert/strict";
import test from "node:test";
import { eligibleAgInvestCandidate } from "./omxs30Scope.ts";

test("OMXS30 validation accepts Investor B and applies the dated Lifco-to-Sobi change", () => {
  assert.equal(eligibleAgInvestCandidate("SE", "INVE B", "2026-11-24"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "Investor B", "2026-11-24"), true);
  assert.equal(eligibleAgInvestCandidate("US", "AAPL", "2026-11-24"), false);
  assert.equal(eligibleAgInvestCandidate("SE", "AAPL", "2026-11-24"), false);

  assert.equal(eligibleAgInvestCandidate("SE", "LIFCO-B", "2026-11-30"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "SOBI", "2026-11-30"), false);
  assert.equal(eligibleAgInvestCandidate("SE", "LIFCO-B", "2026-12-01"), false);
  assert.equal(eligibleAgInvestCandidate("SE", "SOBI", "2026-12-01"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "SKFVER-B", "2026-11-27"), false);
});
