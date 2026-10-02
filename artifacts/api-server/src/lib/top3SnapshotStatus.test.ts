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

test("today's official selection waits for both sources without a timed cutoff", () => {
  const status = describeTop3Snapshot(base, new Date("2026-09-28T12:00:00Z"));
  assert.equal(status.state, "WAITING_FOR_SOURCES");
  assert.deepEqual(status.requiredSources, ["telegram", "edgeai"]);
  assert.match(status.unavailableReason ?? "", /Föregående|föregående/);
  assert.equal(status.cutoffAt, null);
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

test("waiting for sources does not expire at 16:30", () => {
  const status = describeTop3Snapshot(base, new Date("2026-09-28T19:00:00Z"));
  assert.equal(status.state, "WAITING_FOR_SOURCES");
  assert.equal(status.available, false);
  assert.equal(status.cutoffAt, null);
});

test("an immediate frozen cohort reports its real boundary and both sources", () => {
  const frozenAt = new Date("2026-09-28T09:00:00Z");
  const status = describeTop3Snapshot({
    ...base, top3SnapshotAt: frozenAt, top3CutoffAt: frozenAt,
    top3CutoffEvaluatedAt: frozenAt, top3PolicyVersion: "official-top3-v4",
    top3ParticipatingSources: ["edgeai", "telegram"],
  }, new Date("2026-09-28T10:00:00Z"));
  assert.equal(status.state, "AVAILABLE");
  assert.equal(status.cutoffAt, frozenAt);
  assert.equal(status.selectedAt, frozenAt);
  assert.deepEqual(status.requiredSources, ["telegram", "edgeai"]);
});

test("legacy timed snapshots retain their recorded boundary and two-source requirement", () => {
  const cutoff = new Date("2026-09-28T14:30:00Z");
  const status = describeTop3Snapshot({
    ...base, top3SnapshotAt: cutoff, top3CutoffAt: cutoff,
    top3CutoffEvaluatedAt: cutoff, top3PolicyVersion: "official-top3-v3",
    top3ParticipatingSources: ["edgeai", "telegram"],
  }, new Date("2026-09-29T10:00:00Z"));
  assert.equal(status.state, "AVAILABLE");
  assert.equal(status.cutoffAt, cutoff);
  assert.equal(status.policyVersion, "official-top3-v3");
  assert.deepEqual(status.requiredSources, ["telegram", "edgeai"]);
});