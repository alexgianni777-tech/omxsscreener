import assert from "node:assert/strict";
import { test } from "node:test";
import type { Top3Session } from "./useTop3Analytics";
import { top3SessionsForSource } from "./top3SourceViews";

test("mixed official session produces independent legacy and EdgeAI stats", () => {
  const session = {
    date: "2026-09-29",
    sessionId: 1,
    selectionStatus: "AVAILABLE",
    source: "mixed",
    picks: [
      { candidateId: 1, signalSource: "telegram", direction: "LONG", outcome: "WIN", r: 2 },
      { candidateId: 2, signalSource: "edgeai", direction: "SHORT", outcome: "LOSS", r: -1 },
    ],
    sessionR: 1,
    cumulativeR: 1,
    edgeWinRate: 0.6,
    matured: true,
  } as Top3Session;

  const legacy = top3SessionsForSource([session], "telegram");
  const edgeai = top3SessionsForSource([session], "edgeai");
  assert.deepEqual(legacy[0].picks.map((pick) => pick.candidateId), [1]);
  assert.deepEqual(edgeai[0].picks.map((pick) => pick.candidateId), [2]);
  assert.equal(legacy[0].sessionR, 2);
  assert.equal(edgeai[0].sessionR, -1);
  assert.equal(legacy[0].edgeWinRate, null);
  assert.equal(edgeai[0].edgeWinRate, 0.6);
  assert.equal(session.picks.length, 2); // The official selection stays untouched.
});