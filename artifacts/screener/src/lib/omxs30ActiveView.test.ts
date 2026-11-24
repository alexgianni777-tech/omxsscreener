import assert from "node:assert/strict";
import test from "node:test";
import {
  activeOmxs30Candidate,
  filterActiveOmxs30Candidates,
  filterArchivedCandidates,
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

test("pre-scope and invalid session dates fail closed", () => {
  assert.equal(active("INVE-B", "2026-11-22"), false);
  assert.equal(active("INVE-B", "2026-02-30"), false);
});
