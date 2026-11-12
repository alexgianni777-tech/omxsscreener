import assert from "node:assert/strict";
import test from "node:test";
import { appendTop3Revision, buildRevisionInputs, mapTop3Revision } from "./top3SelectionRevisions";
import { buildTop3SelectionSnapshot, TOP3_POLICY_VERSION } from "./top3SelectionPolicyCore";

const day = "2026-10-02";
const time = new Date(`${day}T10:00:00Z`);
function candidate(id: number, source: "telegram" | "edgeai", overrides: Record<string, unknown> = {}) {
  return {
    id, ticker: `TICK${id}`, category: "MOMENTUM", rank: id, market: "SE", direction: "LONG",
    signalSource: source, signalDate: day, createdAt: time,
    price: 100, perf1m: 3, rs3m: 2, rsi: 50, pctB: 0.5, distFrom20dH: 1,
    edgeExpectancyR: 0.2, edgeSampleN: 100, signalAgeBars: 0, maxHoldDays: 10,
    signalRsi: 50, signalGapPct: 0, volMultiplier: 1, volumeAsOf: "2026-10-01",
    earningsInDays: 30, earningsKnowledge: "SIGNAL_TIME",
    entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2, ...overrides,
  } as any;
}
function tx() {
  const rows: any[] = [];
  const query: any = {
    from: () => query, where: () => query, orderBy: () => query,
    limit: async () => rows.slice(-1),
  };
  return {
    rows, select: () => query,
    insert: () => ({
      values: (row: any) => ({
        onConflictDoNothing: async () => { rows.push(structuredClone(row)); },
      }),
    }),
  };
}
const session = { id: 51, date: day, source: "mixed" };

test("fresh revision prices replace recommendations without changing original trade rows", () => {
  const original = candidate(1, "edgeai", { outcome: "WIN", exitPrice: 110, realizedR: 2 });
  const telegram = candidate(2, "telegram");
  const fresh = { ...original, price: 120, entryPrice: 120, stopPrice: 114, targetPrice: 132 };
  const before = structuredClone(original);
  const inputs = buildRevisionInputs([original, telegram], [fresh], undefined, day, time);
  assert.equal(inputs.find((row) => row.id === 1)?.entryPrice, 120);
  assert.deepEqual(original, before);
  assert.equal(original.entryPrice, 100);
  assert.equal(original.realizedR, 2);
});

test("updating one source retains the other source's newest inputs, not its older trade plan", () => {
  const persisted = [candidate(1, "edgeai"), candidate(2, "telegram")];
  const previous = buildRevisionInputs(persisted, [
    { ...persisted[0], entryPrice: 120, stopPrice: 114, targetPrice: 132 },
  ], undefined, day, time);
  const next = buildRevisionInputs(persisted, [
    { ...persisted[1], entryPrice: 110, stopPrice: 105, targetPrice: 120 },
  ], JSON.parse(JSON.stringify(previous)), day, time);
  assert.equal(next.find((row) => row.id === 1)?.entryPrice, 120);
  assert.equal(next.find((row) => row.id === 2)?.entryPrice, 110);
});

test("missing candidates leave the current imported source but remain in prior version history", () => {
  const persisted = [candidate(1, "edgeai"), candidate(2, "edgeai"), candidate(3, "telegram")];
  const previous = buildRevisionInputs(persisted, [], undefined, day, time);
  const next = buildRevisionInputs(persisted, [persisted[1]], previous, day, time);
  assert.deepEqual(next.map((row) => row.id), [2, 3]);
  assert.deepEqual(previous.map((row) => row.id), [1, 2, 3]);
});

test("unknown, old and future signal evidence cannot be relabeled as today's source", () => {
  const persisted = [
    candidate(1, "edgeai"), candidate(2, "telegram", { signalDate: null }),
    candidate(3, "telegram", { signalDate: "2026-10-01" }),
    candidate(4, "telegram", { createdAt: new Date(time.getTime() + 1) }),
  ];
  const next = buildRevisionInputs(persisted, persisted.map((row) => ({ ...row, signalDate: day })), undefined, day, time);
  assert.deepEqual(next.map((row) => row.id), [1]);
});

test("every changed import appends a version; identical data and scheduler ticks are idempotent", async () => {
  const persisted = [candidate(1, "edgeai"), candidate(2, "telegram")];
  const database = tx();
  await appendTop3Revision(database, session, persisted, persisted, time);
  assert.equal(database.rows.length, 1);
  assert.equal(database.rows[0].available, true);
  const initial = structuredClone(database.rows[0]);
  const later = new Date(time.getTime() + 60_000);
  await appendTop3Revision(database, session, persisted, persisted, later);
  await appendTop3Revision(database, session, persisted, [], later);
  assert.equal(database.rows.length, 1);
  const incoming = { ...persisted[0], price: 120, entryPrice: 120, stopPrice: 114, targetPrice: 132 };
  await appendTop3Revision(database, session, persisted, [incoming], later);
  assert.equal(database.rows.length, 2);
  assert.equal(database.rows[1].revision, 2);
  assert.deepEqual(database.rows[0], initial);
  const displayed = mapTop3Revision(database.rows[1]);
  assert.equal(displayed.picks.find((pick) => pick.candidateId === 1)?.entryPrice, 120);
  assert.equal(displayed.policyVersion, TOP3_POLICY_VERSION);
});

test("one-source imports stay incomplete; blocked latest data produces no fabricated picks", async () => {
  const database = tx();
  const edgeai = candidate(1, "edgeai");
  await appendTop3Revision(database, session, [edgeai], [edgeai], time);
  assert.equal(database.rows[0].available, false);
  const telegram = candidate(2, "telegram");
  await appendTop3Revision(database, session, [edgeai, telegram], [telegram], time);
  assert.equal(database.rows[1].available, true);
  const noTrade = [{ ...edgeai, volMultiplier: 0 }, { ...telegram, volMultiplier: 0 }];
  await appendTop3Revision(database, session, [edgeai, telegram], noTrade, time);
  assert.equal(database.rows[2].available, true);
  assert.equal(mapTop3Revision(database.rows[2]).picks.length, 0);
});

test("an explicitly empty source removes only its current proposals and keeps old versions", async () => {
  const database = tx();
  const persisted = [candidate(1, "edgeai"), candidate(2, "telegram")];
  await appendTop3Revision(database, session, persisted, persisted, time);
  const original = structuredClone(database.rows[0]);
  await appendTop3Revision(database, session, persisted, [], time, ["edgeai"]);
  assert.equal(database.rows[1].available, false);
  assert.deepEqual(database.rows[1].sources, ["telegram"]);
  assert.deepEqual(database.rows[0], original);
});

test("revisions retain the negative SHORT exception and LONG negative-expectancy gate", () => {
  const inputs = buildRevisionInputs([
    candidate(1, "edgeai", { direction: "SHORT", stopPrice: 105, targetPrice: 90, edgeExpectancyR: -0.2 }),
    candidate(2, "telegram"),
    candidate(3, "edgeai", { edgeExpectancyR: -0.2 }),
  ], [], undefined, day, time);
  const rows = buildTop3SelectionSnapshot(inputs, session.id, day, session.source, time);
  assert.equal(rows.find((row) => row.candidateId === 1)?.selected, true);
  assert.equal(rows.find((row) => row.candidateId === 3)?.selected, false);
});