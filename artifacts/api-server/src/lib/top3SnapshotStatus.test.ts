import assert from "node:assert/strict";
import test from "node:test";
import { describeTop3Snapshot } from "./top3SnapshotStatus.ts";

const today = "2026-09-28";
const base = {
  date: today,
  top3SnapshotAt: null,
  top3PolicyVersion: null,
  top3CutoffAt: null,
  top3CutoffEvaluatedAt: null,
  top3ParticipatingSources: null,
};

test("today's official selection waits for the fixed Stockholm cutoff", () => {
  const status = describeTop3Snapshot(base, new Date("2026-09-28T12:00:00Z"));
  assert.equal(status.state, "WAITING_FOR_CUTOFF");
  assert.deepEqual(status.requiredSources, ["telegram", "edgeai"]);
  assert.match(status.unavailableReason ?? "", /16:30/);
});

test("evaluated but incomplete sources are not presented as historical legacy data", () => {
  const status = describeTop3Snapshot({
    ...base,
    top3CutoffEvaluatedAt: new Date("2026-09-28T14:32:00Z"),
    top3ParticipatingSources: ["telegram"],
  }, new Date("2026-09-28T14:40:00Z"));
  assert.equal(status.state, "MISSING_SOURCES");
  assert.match(status.unavailableReason ?? "", /edgeai/);
  assert.equal(status.available, false);
});