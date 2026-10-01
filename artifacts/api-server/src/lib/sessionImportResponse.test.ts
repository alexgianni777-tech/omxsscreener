import assert from "node:assert/strict";
import test from "node:test";
import { ReimportSessionResponse } from "@workspace/api-zod";
import { parseSessionImportResponse } from "./sessionImportResponse";

const base = {
  id: 7,
  date: "2026-09-30",
  source: "manual",
  createdAt: new Date("2026-09-30T10:00:00Z"),
  lastImportAt: new Date("2026-09-30T11:00:00Z"),
  omxsValue: 3000,
  perf5d: 1,
  perf1m: 2,
  perf3m: 3,
  marketRsi: 50,
  trendLabel: "BULL",
  top3SnapshotAt: null,
  top3PolicyVersion: null,
  top3CutoffAt: null,
  top3CutoffEvaluatedAt: null,
  top3ParticipatingSources: null,
} as Parameters<typeof parseSessionImportResponse>[0];

test("new imports include the required snapshot contract even without a snapshot", () => {
  const response = parseSessionImportResponse(base, []);
  assert.equal(response.top3SelectionSnapshot.available, false);
  assert.deepEqual(response.top3SelectionSnapshot.requiredSources, ["telegram", "edgeai"]);
});

test("force import and reimport return the final saved snapshot and import timestamp", () => {
  const selectedAt = new Date("2026-09-30T14:30:00Z");
  const finalSession = {
    ...base,
    source: "mixed",
    top3SnapshotAt: selectedAt,
    top3PolicyVersion: "official-top3-v2",
    top3CutoffAt: selectedAt,
    top3CutoffEvaluatedAt: selectedAt,
    top3ParticipatingSources: ["telegram", "edgeai"],
  };
  const diff = { added: [], updated: [], removed: [] };
  const response = ReimportSessionResponse.parse(parseSessionImportResponse(finalSession, [], diff));
  assert.equal(response.top3SelectionSnapshot.state, "AVAILABLE");
  assert.deepEqual(response.top3SelectionSnapshot.selectedAt, selectedAt);
  assert.deepEqual(response.lastImportAt, base.lastImportAt);
  assert.deepEqual(response.importDiff, diff);
});

test("invalid candidates throw during response construction, before the route transaction commits", () => {
  assert.throws(() => parseSessionImportResponse(base, [{ ticker: "INVALID" }]));
});