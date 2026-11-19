import assert from "node:assert/strict";
import test from "node:test";
import type { Candidate, SessionSourceReport } from "@workspace/api-client-react";
import { candidateReceipt, radarSourceHealth, selectRadarLane } from "./marketRadarModel";

const candidate = (id: number, source: "edgeai" | "telegram" | "screener", rank: number) =>
  ({ id, ticker: `T${id}`, market: "SE", direction: "LONG", signalSource: source, rank }) as Candidate;

test("radar caps each lane while representing independent available sources", () => {
  const rows = [
    candidate(1, "edgeai", 1), candidate(2, "edgeai", 2), candidate(3, "edgeai", 3),
    candidate(4, "telegram", 1), candidate(5, "telegram", 2), candidate(6, "screener", 1),
    candidate(7, "edgeai", 4), candidate(8, "telegram", 3),
  ];
  const selected = selectRadarLane(rows, "SE", "LONG", 5);
  assert.equal(selected.length, 5);
  assert.deepEqual(new Set(selected.map(row => row.signalSource)), new Set(["edgeai", "telegram", "screener"]));
  assert.equal(selectRadarLane(rows, "US", "LONG").length, 0);
  assert.equal(selectRadarLane(rows, "SE", "SHORT").length, 0);
  assert.equal(selectRadarLane(rows, "SE", "LONG", 0).length, 0);
});

test("candidate receipt is matched by source, signal date and market data day", () => {
  const signal = {
    ...candidate(1, "edgeai", 1),
    signalDate: "2026-11-19",
    dataQuality: { dataAsOf: "2026-11-18" },
  } as Candidate;
  const reports = [
    { source: "edgeai", status: "SUCCESS", signalDate: "2026-11-18", importedAt: "2026-11-19T10:00:00Z", dataDates: { SE: "2026-11-17", US: null } },
    { source: "edgeai", status: "SUCCESS", signalDate: "2026-11-19", importedAt: "2026-11-19T11:00:00Z", dataDates: { SE: "2026-11-18", US: null } },
  ] as SessionSourceReport[];
  assert.equal(candidateReceipt(signal, reports), reports[1]);
  assert.equal(candidateReceipt(signal, [reports[0]]), null);
  assert.equal(candidateReceipt(signal, [reports[1], { ...reports[1] }]), null);
});

test("a failed or missing source receipt is explicit and does not imply no candidates from other sources", () => {
  const candidates = [candidate(1, "edgeai", 1)];
  const reports = [
    { source: "edgeai", status: "SUCCESS", importedAt: "2026-11-19T10:00:00Z" },
    { source: "telegram", status: "FAILED", importedAt: "2026-11-19T10:05:00Z" },
  ] as SessionSourceReport[];
  const health = radarSourceHealth(candidates, reports);
  assert.equal(health.find(item => item.source === "edgeai")?.status, "IMPORTED");
  assert.equal(health.find(item => item.source === "telegram")?.status, "FAILED");
  assert.equal(health.find(item => item.source === "screener")?.status, "NO_RECEIPT");
  assert.equal(health.find(item => item.source === "edgeai")?.candidateCount, 1);
});
