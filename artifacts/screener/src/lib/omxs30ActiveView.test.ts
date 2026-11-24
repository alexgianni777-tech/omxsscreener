import test from "node:test";
import assert from "node:assert/strict";
import { activeOmxs30Candidate } from "./omxs30ActiveView";

const eligible = (ticker: string, sessionDate = "2026-11-24", market = "SE") =>
  activeOmxs30Candidate({ ticker, sessionDate, market });

test("official OMXS30 members including Investor B are active", () => {
  assert.equal(eligible("INVE-B"), true);
  assert.equal(eligible("INVE-B.ST"), true);
  assert.equal(eligible("ABB.ST"), true);
});
test("US, out-of-index SE and pre-reset history are not in active view", () => {
  assert.equal(eligible("AAPL", "2026-11-24", "US"), false);
  assert.equal(eligible("MYCR.ST"), false);
  assert.equal(eligible("INVE-B", "2026-11-22"), false);
  assert.equal(eligible("INVE-B", "bad-date"), false);
});
test("reconstitution changes on December 1 decision date", () => {
  assert.equal(eligible("LIFCO-B", "2026-11-30"), true);
  assert.equal(eligible("SOBI", "2026-11-30"), false);
  assert.equal(eligible("LIFCO-B", "2026-12-01"), false);
  assert.equal(eligible("SOBI", "2026-12-01"), true);
});
test("temporary SKF Vertevo inclusion remains research only", () => {
  assert.equal(eligible("SKFVER-B", "2026-11-27"), false);
});
