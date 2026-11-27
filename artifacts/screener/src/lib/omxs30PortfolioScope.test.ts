import assert from "node:assert/strict";
import test from "node:test";
import {
  activeOmxs30PortfolioPosition,
  partitionOmxs30JournalRecords,
  partitionPortfolioPositions,
} from "./omxs30PortfolioScope.ts";

test("portfolio active view uses dated OMXS30 membership and underlying for products", () => {
  const positions = [
    { id: 1, ticker: "ABB", market: "SE" },
    { id: 2, ticker: "Turbo ABC", underlyingTicker: "INVE-B", market: "SE" },
    { id: 3, ticker: "AAPL", market: "US" },
    { id: 4, ticker: "MYCR", market: "SE" },
    { id: 5, ticker: "LIFCO-B", market: "SE" },
    { id: 6, ticker: "SOBI", market: "SE" },
  ];
  assert.equal(activeOmxs30PortfolioPosition(positions[1], "2026-11-30"), true);
  assert.deepEqual(
    partitionPortfolioPositions(positions, "2026-11-30").active.map(position => position.id),
    [1, 2, 5],
  );
  assert.deepEqual(
    partitionPortfolioPositions(positions, "2026-12-01").active.map(position => position.id),
    [1, 2, 6],
  );
  assert.deepEqual(
    partitionPortfolioPositions(positions, "2026-12-01").archived.map(position => position.id),
    [3, 4, 5],
  );
});

test("journal keeps only session-dated OMXS30 records active; unknown and US history archives", () => {
  const candidates = [
    { id: 1, ticker: "INVE-B", market: "SE", sessionDate: "2026-11-27" },
    { id: 2, ticker: "AAPL", market: "US", sessionDate: "2026-11-27" },
    { id: 3, ticker: "MYCR", market: "SE", sessionDate: "2026-11-27" },
    { id: 4, ticker: "INVE-B", market: "SE", sessionDate: "2026-11-22" },
  ];
  const records = [1, 2, 3, 4, 99].map(candidateId => ({ input: { candidateId } }));
  const split = partitionOmxs30JournalRecords(records, candidates);
  assert.deepEqual(split.active.map(record => record.input.candidateId), [1]);
  assert.deepEqual(split.archived.map(record => record.input.candidateId), [2, 3, 4, 99]);
});
