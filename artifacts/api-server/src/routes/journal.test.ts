import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { journalRouter, type JournalStore } from "./journal";
import { journalMetrics, type JournalEntryInput, type JournalRecord } from "../lib/tradeJournal";

const input: JournalEntryInput = {
  id: "8ffbc14b-34e6-4074-9e62-4fb593529ab5", candidateId: 1, mode: "SIMULATED",
  instrumentKind: "PRODUCT", side: "LONG", priceCurrency: "SEK",
  entryTime: "2026-10-01T08:00:00Z", exitTime: "2026-10-01T09:00:00Z",
  fillPrice: 100, stopPrice: 95, targetPrice: 110, exitPrice: 110, quantity: 10,
  financingCostKr: 0, commissionKr: 0, notes: "TEST",
};
test("journal API persists an immutable snapshot, deduplicates retries and never writes signals", async () => {
  const rows = new Map<string, Awaited<ReturnType<JournalStore["insert"]>>>();
  let candidateReads = 0;
  const source = { ticker: "TEST", signalSource: "edgeai", signalDate: "2026-10-01", volumeAsOf: "2026-10-01",
    category: "WEAKEST", direction: "SHORT", sessionId: 1, entryPrice: 200, stopPrice: 210, targetPrice: 180, rr: 2 };
  const storage: JournalStore = {
    list: async () => [...rows.values()],
    find: async id => rows.get(id),
    candidate: async () => { candidateReads++; return source as any; },
    insert: async (id, payload) => {
      if (!rows.has(id)) rows.set(id, { id, payload, createdAt: new Date("2026-10-02T08:00:00Z") });
      return rows.get(id)!;
    },
  };
  const app = express(); app.use(express.json()); app.use(journalRouter(storage));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/journal`;
  const post = (data: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  try {
    const before = JSON.stringify(source);
    const saved = await post(input);
    assert.equal(saved.status, 201);
    const record = await saved.json() as JournalRecord;
    assert.equal(record.signal.direction, "SHORT");
    assert.equal(record.input.side, "LONG");
    assert.equal(record.metrics.netR, 2);
    assert.equal(record.signal.entryPrice, 200);
    assert.equal(JSON.stringify(source), before);
    const same = await post(Object.fromEntries(Object.entries(input).reverse()));
    assert.equal(same.status, 201);
    assert.deepEqual(await same.json(), record);
    assert.equal(rows.size, 1);
    assert.equal(candidateReads, 1);
    const conflict = await post({ ...input, exitPrice: 109 });
    assert.equal(conflict.status, 409);
    assert.equal(rows.size, 1);
    source.entryPrice = 999;
    const reloaded = await (await fetch(url)).json() as JournalRecord[];
    assert.equal(reloaded[0].signal.entryPrice, 200);
    const bad = await post({ ...input, id: "bad" });
    assert.equal(bad.status, 400);
    const invalid = await post({ ...input, quantity: 0 });
    assert.equal(invalid.status, 400);
    assert.deepEqual(record.metrics, journalMetrics(input));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
