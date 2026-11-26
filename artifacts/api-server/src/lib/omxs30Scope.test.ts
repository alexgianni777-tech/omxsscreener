import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleAgInvestCandidate,
  findAgInvestScopeViolations,
  isOmxs30ResearchOnlyCandidate,
} from "./omxs30Scope.ts";

test("OMXS30 validation accepts Investor B and applies the dated Lifco-to-Sobi change", () => {
  assert.equal(eligibleAgInvestCandidate("SE", "INVE B", "2026-11-24"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "Investor B", "2026-11-24"), true);
  assert.equal(eligibleAgInvestCandidate("US", "AAPL", "2026-11-24"), false);
  assert.equal(eligibleAgInvestCandidate("SE", "AAPL", "2026-11-24"), false);

  assert.equal(eligibleAgInvestCandidate("SE", "LIFCO-B", "2026-11-30"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "SOBI", "2026-11-30"), false);
  assert.equal(eligibleAgInvestCandidate("SE", "LIFCO-B", "2026-12-01"), false);
  assert.equal(eligibleAgInvestCandidate("SE", "SOBI", "2026-12-01"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "SKFVER-B", "2026-11-25"), false);
  assert.equal(eligibleAgInvestCandidate("SE", "SKFVER-B", "2026-11-26"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "SKFVER-B", "2026-11-30"), true);
  assert.equal(eligibleAgInvestCandidate("SE", "SKFVER-B", "2026-12-01"), false);
  assert.equal(isOmxs30ResearchOnlyCandidate("SE", "SKFVER-B", "2026-11-26"), true);
  assert.equal(isOmxs30ResearchOnlyCandidate("SE", "SKFVER-B", "2026-12-01"), false);
});

test("import scope rejects US and Swedish non-index proposals while keeping Investor B", () => {
  const violations = findAgInvestScopeViolations({
    SE: [{ ticker: "INVE-B" }, { ticker: "MYCR" }],
    US: [{ ticker: "AAPL" }],
  }, "2026-11-24");

  assert.deepEqual(violations, [
    { market: "SE", ticker: "MYCR" },
    { market: "US", ticker: "AAPL" },
  ]);
  assert.equal(eligibleAgInvestCandidate("SE", "INVE-B", "2026-11-24"), true);
});

test("import scope uses the decision day rather than the prior-close data date", () => {
  const dataAsOf = "2026-11-30";
  const decisionDate = "2026-12-01";
  assert.equal(eligibleAgInvestCandidate("SE", "LIFCO-B", dataAsOf), true);
  assert.deepEqual(
    findAgInvestScopeViolations({ SE: [{ ticker: "LIFCO-B" }] }, decisionDate),
    [{ market: "SE", ticker: "LIFCO-B" }],
  );
  assert.equal(eligibleAgInvestCandidate("SE", "SOBI", decisionDate), true);
});
