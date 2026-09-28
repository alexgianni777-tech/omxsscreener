import assert from "node:assert/strict";
import test from "node:test";
import { screenerSessionsTable } from "@workspace/db";
import { snapshotNewSessionTop3 } from "./top3SelectionPolicy.ts";
import { top3CutoffForDate } from "./top3SelectionPolicyCore.ts";

function stockholmDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function candidate(
  id: number,
  ticker: string,
  signalDate: string,
  signalSource: "manual" | "telegram" | "edgeai",
  createdAt: Date,
) {
  return {
    id,
    createdAt,
    ticker,
    category: "MOMENTUM",
    rank: id,
    market: "SE",
    direction: "LONG",
    signalSource,
    signalDate,
    price: 100,
    perf1m: 2,
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
    volumeAsOf: "2020-01-01",
    earningsInDays: 30,
    earningsKnowledge: "SIGNAL_TIME",
    entryPrice: 100,
    stopPrice: 95,
    targetPrice: 106,
    rr: 1.2,
  };
}

function transaction(candidates: any[], sharedSession?: any) {
  const session: any = sharedSession ?? {
    id: 900,
    top3SnapshotAt: null,
    top3CutoffAt: null,
    top3CutoffEvaluatedAt: null,
    top3ParticipatingSources: null,
  };
  const inserted: any[] = [];
  return {
    session,
    inserted,
    select: () => {
      let selectedTable: unknown;
      const query: any = {
        from(table: unknown) {
          selectedTable = table;
          return query;
        },
        where() {
          return Promise.resolve(selectedTable === screenerSessionsTable ? [session] : candidates);
        },
      };
      return query;
    },
    insert: () => ({
      values: async (rows: any[]) => {
        inserted.push(...rows);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        return {
          where: () => ({
            returning: async () => {
              if (session.top3CutoffEvaluatedAt) return [];
              Object.assign(session, values);
              return [{ id: session.id }];
            },
          }),
        };
      },
    }),
  };
}

test("before cutoff, imports do not seal the session", async () => {
  const date = stockholmDate();
  const cutoff = top3CutoffForDate(date);
  const telegram = candidate(1, "TELEGRAM", date, "telegram", new Date(cutoff.getTime() - 60 * 60_000));
  const edgeai = candidate(2, "EDGEAI", date, "edgeai", new Date(cutoff.getTime() - 30 * 60_000));
  const tx = transaction([telegram, edgeai]);
  await snapshotNewSessionTop3(
    tx as any,
    { id: 900, date, source: "mixed" },
    [],
    new Date(cutoff.getTime() - 1),
  );
  assert.equal(tx.session.top3SnapshotAt, null);
  assert.equal(tx.session.top3CutoffEvaluatedAt, null);
  assert.equal(tx.inserted.length, 0);
});

test("cutoff includes both pre-cutoff sources regardless of arrival order", async () => {
  const date = stockholmDate();
  const cutoff = top3CutoffForDate(date);
  for (const sourceOrder of [
    ["telegram", "edgeai"],
    ["edgeai", "telegram"],
  ] as const) {
    const candidates = sourceOrder.map((source, index) =>
      candidate(index + 1, `${source.toUpperCase()}-${sourceOrder.join("-")}`, date, source, new Date(cutoff.getTime() - (index + 1) * 60_000)),
    );
    const tx = transaction(candidates);
    const evaluatedAt = new Date(cutoff.getTime() + 5 * 60_000);
    await snapshotNewSessionTop3(tx as any, { id: 901, date, source: "mixed" }, [], evaluatedAt);
    assert.equal(tx.session.top3SnapshotAt?.getTime(), evaluatedAt.getTime());
    assert.equal(tx.session.top3CutoffAt?.getTime(), cutoff.getTime());
    assert.equal(tx.session.top3CutoffEvaluatedAt?.getTime(), evaluatedAt.getTime());
    assert.deepEqual(tx.session.top3ParticipatingSources, ["edgeai", "telegram"]);
    assert.deepEqual(tx.inserted.map((row) => row.candidateId).sort(), [1, 2]);
    assert.ok(tx.inserted.every((row) => row.selectedAt.getTime() === evaluatedAt.getTime()));
  }
});

test("concurrent import and scheduler evaluations can only claim and insert one seal", async () => {
  const date = stockholmDate();
  const cutoff = top3CutoffForDate(date);
  const evaluatedAt = new Date(cutoff.getTime() + 5 * 60_000);
  const session: any = {
    id: 904,
    top3SnapshotAt: null,
    top3CutoffAt: null,
    top3CutoffEvaluatedAt: null,
    top3ParticipatingSources: null,
  };
  const arrivals = [
    candidate(1, "TELEGRAM", date, "telegram", new Date(cutoff.getTime() - 60_000)),
    candidate(2, "EDGEAI", date, "edgeai", new Date(cutoff.getTime() - 30_000)),
  ];
  const importTx = transaction(arrivals, session);
  const schedulerTx = transaction(arrivals, session);
  await Promise.all([
    snapshotNewSessionTop3(importTx as any, { id: session.id, date, source: "mixed" }, [], evaluatedAt),
    snapshotNewSessionTop3(schedulerTx as any, { id: session.id, date, source: "mixed" }, [], evaluatedAt),
  ]);

  assert.ok(session.top3SnapshotAt instanceof Date);
  assert.equal(importTx.inserted.length + schedulerTx.inserted.length, 2);
  assert.ok([importTx.inserted.length, schedulerTx.inserted.length].includes(2));
});

test("missing source at cutoff makes the day unavailable and a late source cannot seal it", async () => {
  const date = stockholmDate();
  const cutoff = top3CutoffForDate(date);
  const telegram = candidate(1, "TELEGRAM", date, "telegram", new Date(cutoff.getTime() - 1));
  const arrivals = [telegram];
  const tx = transaction(arrivals);
  await snapshotNewSessionTop3(tx as any, { id: 902, date, source: "telegram" }, [], cutoff);
  assert.equal(tx.session.top3SnapshotAt, null);
  assert.equal(tx.session.top3CutoffAt?.getTime(), cutoff.getTime());
  assert.ok(tx.session.top3CutoffEvaluatedAt instanceof Date);
  assert.deepEqual(tx.session.top3ParticipatingSources, ["telegram"]);

  const lateEdgeAi = candidate(2, "LATE-EDGEAI", date, "edgeai", new Date(cutoff.getTime() + 1));
  arrivals.push(lateEdgeAi);
  await snapshotNewSessionTop3(tx as any, { id: 902, date, source: "mixed" }, [], new Date(cutoff.getTime() + 1));
  assert.equal(tx.session.top3SnapshotAt, null);
  assert.deepEqual(tx.session.top3ParticipatingSources, ["telegram"]);
  assert.equal(tx.inserted.length, 0);
});