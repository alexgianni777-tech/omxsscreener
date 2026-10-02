import assert from "node:assert/strict";
import test from "node:test";
import { edgeAiSessionDate, fetchFreshEdgeAiData, EdgeAiDataFreshnessError } from "./edgeAiSource";

const now = new Date("2026-10-02T10:00:00Z");

test("manual and scheduled EdgeAI fetches accept yesterday while preserving generatedAt", async (context) => {
  const data = { generatedAt: "2026-10-01T16:42:56.439Z" };
  context.mock.method(globalThis, "fetch", async () => Response.json(data));
  const result = await fetchFreshEdgeAiData(1000, { now });
  assert.equal(result.generatedAt, data.generatedAt);
  assert.equal(edgeAiSessionDate(result), "2026-10-01");
});

test("EdgeAI fetches reject reports older than the previous close", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ generatedAt: "2026-09-30T16:42:56Z" }));
  await assert.rejects(fetchFreshEdgeAiData(1000, { now }), EdgeAiDataFreshnessError);
});

test("EdgeAI weekend carryover accepts Friday on Monday but not Thursday", async (context) => {
  let generatedAt = "2026-10-02T16:42:56Z";
  context.mock.method(globalThis, "fetch", async () => Response.json({ generatedAt }));
  const monday = new Date("2026-10-05T08:00:00Z");
  assert.equal(edgeAiSessionDate(await fetchFreshEdgeAiData(1000, { now: monday })), "2026-10-02");
  generatedAt = "2026-10-01T16:42:56Z";
  await assert.rejects(fetchFreshEdgeAiData(1000, { now: monday }), EdgeAiDataFreshnessError);
});

test("EdgeAI rejects missing or future timestamps and uses Stockholm at midnight", async (context) => {
  let generatedAt: string | undefined;
  context.mock.method(globalThis, "fetch", async () => Response.json({ generatedAt }));
  await assert.rejects(fetchFreshEdgeAiData(1000, { now }), EdgeAiDataFreshnessError);
  generatedAt = "2026-10-02T11:00:00Z";
  await assert.rejects(fetchFreshEdgeAiData(1000, { now }), EdgeAiDataFreshnessError);
  assert.equal(edgeAiSessionDate({ generatedAt: "2026-10-01T22:15:00Z" }), "2026-10-02");
});