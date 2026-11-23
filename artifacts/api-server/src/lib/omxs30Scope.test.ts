import assert from "node:assert/strict";
import test from "node:test";
import { OMXS30_NOVEMBER, eligibleAgInvestCandidate, omxs30Members,
  requireOmxs30ForNewProposal } from "./omxs30Scope";

test("OMXS30-only portfolio universe has 30 independent Nasdaq members", () => {
  assert.equal(OMXS30_NOVEMBER.length, 30);
  assert.equal(new Set(OMXS30_NOVEMBER).size, 30);
  for(const ticker of ["ADDT-B.ST","INDU-C","LIFCO-B","EPI-A","SKA-B","TELIA.ST"]) {
    assert.equal(eligibleAgInvestCandidate("SE",ticker,"2026-11-23"),true,ticker);
  }
  for(const ticker of ["GETI-B.ST","ELUX-B","SSAB-A","ALIV-SDB","AAPL","NVDA","SOBI.ST"]) {
    assert.equal(eligibleAgInvestCandidate("SE",ticker,"2026-11-23"),false,ticker);
  }
  assert.equal(eligibleAgInvestCandidate("US","ABB.ST","2026-11-23"),false);
});
test("Dec 1 rebalance uses decision date, not D-1 price date", () => {
  assert.ok(omxs30Members("2026-11-30").has("LIFCO-B.ST"));
  assert.ok(!omxs30Members("2026-11-30").has("SOBI.ST"));
  assert.ok(omxs30Members("2026-12-01").has("SOBI.ST"));
  assert.ok(!omxs30Members("2026-12-01").has("LIFCO-B.ST"));
  assert.equal(eligibleAgInvestCandidate("SE","SKFVER-B","2026-11-27"),false);
});
test("unverified time, unknown market and nonmember are blocked",()=>{
  assert.throws(()=>omxs30Members("2026-02-30"));
  assert.throws(()=>requireOmxs30ForNewProposal("US","NVDA","2026-11-23"),
    /AG_INVEST_SCOPE_OMXS30_ONLY/);
  assert.doesNotThrow(()=>requireOmxs30ForNewProposal("SE","ABB","2026-11-23"));
});
