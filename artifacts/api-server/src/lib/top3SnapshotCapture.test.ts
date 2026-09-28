import assert from "node:assert/strict";
import test from "node:test";
import { snapshotNewSessionTop3 } from "./top3SelectionPolicy.ts";

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

function priorDate(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function candidate(id: number, ticker: string, signalDate: string, signalSource: "manual" | "telegram") {
  return {
    id,
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

function transaction() {
  let manifest: Date | null = null;
  const inserted: any[] = [];
  return {
    inserted,
    getManifest: () => manifest,
    select: () => ({
      from: () => ({
        where: async () => [{ top3SnapshotAt: manifest }],
      }),
    }),
    insert: () => ({
      values: async (rows: any[]) => {
        inserted.push(...rows);
      },
    }),
    update: () => ({
      set: (values: { top3SnapshotAt?: Date }) => ({
        where: async () => {
          if (values.top3SnapshotAt) manifest = values.top3SnapshotAt;
        },
      }),
    }),
  };
}

test("old manual signal leaves session unsealed; same-day import seals once and reimports cannot rewrite it", async () => {
  const date = stockholmDate();
  const tx = transaction();
  const session = { id: 900, date, source: "manual" };
  const oldManual = candidate(1, "OLD", priorDate(date), "manual");

  await snapshotNewSessionTop3(tx as any, session, [oldManual] as any);
  assert.equal(tx.getManifest(), null);
  assert.equal(tx.inserted.length, 0);

  const freshTelegram = candidate(2, "FRESH", date, "telegram");
  await snapshotNewSessionTop3(tx as any, { ...session, source: "telegram" }, [oldManual, freshTelegram] as any);

  const manifestAfterSignal = tx.getManifest();
  assert.ok(manifestAfterSignal instanceof Date);
  assert.deepEqual(tx.inserted.map((row) => row.candidateId), [2]);
  assert.equal(tx.inserted[0].selected, true);
  const frozenRows = structuredClone(tx.inserted);
  const frozenManifest = manifestAfterSignal?.getTime();

  await snapshotNewSessionTop3(
    tx as any,
    { ...session, source: "manual" },
    [oldManual, { ...freshTelegram, perf1m: -50, signalSource: "manual" }] as any,
  );

  assert.deepEqual(tx.inserted, frozenRows);
  assert.equal(tx.getManifest()?.getTime(), frozenManifest);
});