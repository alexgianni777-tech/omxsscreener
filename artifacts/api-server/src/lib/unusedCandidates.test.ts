import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DELETE_UNUSED_CANDIDATES_SQL, UNUSED_CANDIDATE_RETENTION_DAYS, developmentCleanupEnabled,
} from "./unusedCandidates";

test("three-day cleanup cannot run in production or an unspecified environment", () => {
  assert.equal(UNUSED_CANDIDATE_RETENTION_DAYS, 3);
  assert.equal(developmentCleanupEnabled("development"), true);
  for (const env of ["production", "test", "", undefined]) assert.equal(developmentCleanupEnabled(env), false);
});
test("cleanup preserves latest source/market, noted/resolved trades and immutable references", () => {
  for (const clause of [
    "INTERVAL '3 days'", "Europe/Stockholm", "c.outcome = 'PENDING'", "c.is_top3_pick",
    "c.exit_price IS NULL", "c.realized_r IS NULL", "c.outcome_notes", "c.resolution_entry_price IS NULL",
    "COALESCE(newest.market", "COALESCE(newest.signal_source", "top3_selection_snapshots",
    "rev.selections, rev.inputs", "$.**.candidateId", "$.**.id",
    "trade_journal", "survival_trades", "open_positions",
  ]) assert.ok(DELETE_UNUSED_CANDIDATES_SQL.includes(clause), clause);
  assert.match(DELETE_UNUSED_CANDIDATES_SQL, /DELETE FROM candidates c/);
  assert.doesNotMatch(DELETE_UNUSED_CANDIDATES_SQL, /DELETE FROM (screener_sessions|top3_|trade_journal|survival_trades)/);
});
test("maintenance remains manual, private, transactional and does not change import scheduling", () => {
  const route = readFileSync(new URL("../routes/unusedCandidates.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
  assert.match(route, /db.transaction/);
  assert.match(route, /SHARE ROW EXCLUSIVE MODE/);
  assert.ok(index.indexOf("router.use(requireAdministrator)") < index.indexOf("router.use(unusedCandidatesRouter)"));
  assert.doesNotMatch(route, /setInterval|setTimeout|scheduler/);
});
