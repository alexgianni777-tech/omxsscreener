import assert from "node:assert/strict";
import test from "node:test";
import { ReimportSessionResponse } from "@workspace/api-zod";
import { parseSessionImportResponse } from "./sessionImportResponse";

const base = {
  id: 7,
  date: "2000-01-01",
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
  assert.deepEqual(response.top3SelectionSnapshot.requiredSources, []);
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

test("import responses derive live source receipts from final raw DB candidates", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const rawCandidate = {
    id: 18,
    ticker: "LIVE",
    category: "MOMENTUM",
    rank: 1,
    market: "SE",
    direction: "LONG",
    signalSource: "telegram",
    signalDate: "2026-09-30",
    createdAt: new Date("2026-09-30T09:30:00.000Z"),
    price: 100,
    perf1m: 4,
    rs3m: 3,
    rsi: 50,
    pctB: 0.5,
    distFrom20dH: 1,
    edgeExpectancyR: null,
    edgeSampleN: null,
    signalAgeBars: null,
    maxHoldDays: 10,
    signalRsi: null,
    signalGapPct: null,
    volMultiplier: 1,
    volumeAsOf: "2026-09-29",
    earningsInDays: 30,
    earningsKnowledge: "SIGNAL_TIME",
    entryPrice: 100,
    stopPrice: 95,
    targetPrice: 106,
    rr: 1.2,
  } as any;
  const response = parseSessionImportResponse(
    { ...base, date: "2026-09-30" },
    [],
    undefined,
    [rawCandidate],
    now,
  );

  assert.equal(response.top3LiveSelection?.previewAvailable, true);
  assert.equal(response.top3LiveSelection?.sourceReceipts.telegram.candidateCount, 1);
  assert.equal(response.top3LiveSelection?.picks[0]?.candidateId, rawCandidate.id);
});

test("invalid candidates throw during response construction, before the route transaction commits", () => {
  assert.throws(() => parseSessionImportResponse(base, [{ ticker: "INVALID" }]));
});