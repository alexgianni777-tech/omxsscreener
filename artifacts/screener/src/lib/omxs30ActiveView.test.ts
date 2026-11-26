import assert from "node:assert/strict";
import test from "node:test";
import {
  activeOmxs30Candidate,
  filterActiveOmxs30Candidates,
  filterActiveOmxs30Picks,
  filterArchivedCandidates,
  filterArchivedOmxs30Picks,
  isOmxs30ResearchOnlyCandidate,
} from "./omxs30ActiveView.ts";

const active = (ticker: string, sessionDate = "2026-11-24", market = "SE") =>
  activeOmxs30Candidate({ ticker, sessionDate, market });

test("active candidate view retains Investor B and excludes US and Swedish non-members", () => {
  assert.equal(active("INVE-B"), true);
  assert.equal(active("Investor B"), true);
  assert.equal(active("AAPL", "2026-11-24", "US"), false);
  assert.equal(active("AAPL"), false);
  assert.equal(active("MYCR.ST"), false);

  const rows = [
    { id: 1, ticker: "INVE-B", market: "SE", sessionDate: "2026-11-24" },
    { id: 2, ticker: "AAPL", market: "US", sessionDate: "2026-11-24" },
    { id: 3, ticker: "MYCR", market: "SE", sessionDate: "2026-11-24" },
  ];
  assert.deepEqual(filterActiveOmxs30Candidates(rows).map((row) => row.id), [1]);
  assert.deepEqual(filterArchivedCandidates(rows).map((row) => row.id), [2, 3]);
});

test("dated membership changes from Lifco B to Sobi on December 1", () => {
  assert.equal(active("LIFCO-B", "2026-11-30"), true);
  assert.equal(active("SOBI", "2026-11-30"), false);
  assert.equal(active("LIFCO-B", "2026-12-01"), false);
  assert.equal(active("SOBI", "2026-12-01"), true);
});

test("temporary SKF Vertevo is in the dated scope but explicitly research-only", () => {
  assert.equal(active("SKFVER-B", "2026-11-25"), false);
  assert.equal(active("SKFVER-B", "2026-11-26"), true);
  assert.equal(active("SKFVER-B", "2026-11-30"), true);
  assert.equal(active("SKFVER-B", "2026-12-01"), false);
  assert.equal(isOmxs30ResearchOnlyCandidate({
    ticker: "SKFVER-B", market: "SE", sessionDate: "2026-11-27",
  }), true);
});

test("dashboard Top 3 filters active and archived picks by the session decision date", () => {
  const picks = [
    { ticker: "INVE-B.ST", market: "SE" },
    { ticker: "AAPL", market: "US" },
    { ticker: "MYCR.ST", market: "SE" },
    { ticker: "LIFCO-B.ST", market: "SE" },
    { ticker: "SOBI.ST", market: "SE" },
  ];
  assert.deepEqual(
    filterActiveOmxs30Picks(picks, "2026-11-30").map((pick) => pick.ticker),
    ["INVE-B.ST", "LIFCO-B.ST"],
  );
  assert.deepEqual(
    filterActiveOmxs30Picks(picks, "2026-12-01").map((pick) => pick.ticker),
    ["INVE-B.ST", "SOBI.ST"],
  );
  assert.deepEqual(
    filterArchivedOmxs30Picks(picks, "2026-12-01").map((pick) => pick.ticker),
    ["AAPL", "MYCR.ST", "LIFCO-B.ST"],
  );
});

test("pre-scope and invalid session dates fail closed", () => {
  assert.equal(active("INVE-B", "2026-11-22"), false);
  assert.equal(active("INVE-B", "2026-02-30"), false);
});
