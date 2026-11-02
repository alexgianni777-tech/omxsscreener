import assert from "node:assert/strict";
import test from "node:test";
import { edgeAiSessionDate, fetchFreshEdgeAiData, EdgeAiDataFreshnessError } from "./edgeAiSource";
import { previousTradingDate } from "./signalDatePolicy";

const now = new Date("2026-10-02T10:00:00Z");
const payload = (generatedAt: string) => {
  const reportDate = edgeAiSessionDate({ generatedAt });
  const dataAsOf = previousTradingDate(reportDate);
  return { generatedAt, markets: {
    SE: { dataAsOf, setups: [] },
    US: { dataAsOf, setups: [] },
  } };
};

test("manual and scheduled EdgeAI fetches accept yesterday while preserving generatedAt", async (context) => {
  const data = payload("2026-10-01T16:42:56.439Z");
  context.mock.method(globalThis, "fetch", async () => Response.json(data));
  const result = await fetchFreshEdgeAiData(1000, { now });
  assert.equal(result.data.generatedAt, data.generatedAt);
  assert.equal(edgeAiSessionDate(result.data), "2026-10-01");
  assert.equal(result.rawData, result.data);
  assert.deepEqual(result.quality.errors, []);
});

test("EdgeAI fetches reject reports older than the previous close", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(payload("2026-09-30T16:42:56Z")));
  await assert.rejects(fetchFreshEdgeAiData(1000, { now }), EdgeAiDataFreshnessError);
});

test("EdgeAI weekend carryover accepts Friday on Monday but not Thursday", async (context) => {
  let generatedAt = "2026-10-02T16:42:56Z";
  context.mock.method(globalThis, "fetch", async () => Response.json(payload(generatedAt)));
  const monday = new Date("2026-10-05T08:00:00Z");
  assert.equal(edgeAiSessionDate((await fetchFreshEdgeAiData(1000, { now: monday })).data), "2026-10-02");
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

test("Contents API is canonical and HTTP failure never falls back to the CDN", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("{}", { status: 503 });
  });
  await assert.rejects(fetchFreshEdgeAiData(1000, { now }), /no CDN fallback was used/);
  assert.equal(calls, 1);
});

test("generatedAt must carry an explicit time zone", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(payload("2026-10-02T12:00:00")));
  await assert.rejects(fetchFreshEdgeAiData(1000, { now }), EdgeAiDataFreshnessError);
});