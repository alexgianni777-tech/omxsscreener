import assert from "node:assert/strict";
import test from "node:test";
import { edgeCacheLabel, edgeMarketLabel, type EdgeMarketStatusView } from "./edgeAiImportStatus";

const current: EdgeMarketStatusView = {
  expected: "2026-11-13",
  actual: "2026-11-13",
  status: "CURRENT",
  fresh: true,
  cached: false,
  reason: "VERIFIED",
  source: "Yahoo Finance",
  fetchedAt: "2026-11-14T03:35:14Z",
};

test("EdgeAI import displays transport cache and per-market source/data timestamps", () => {
  assert.equal(edgeCacheLabel("FETCHED"), "GitHub hämtad nu");
  assert.equal(edgeCacheLabel("ETAG_REVALIDATED"), "GitHub bekräftade oförändrad data via ETag");
  assert.equal(edgeCacheLabel("MEMORY_CACHE"), "API-minnescache");
  assert.match(edgeMarketLabel("SE", current), /aktuell · data 2026-11-13 · förväntad 2026-11-13/);
  assert.match(edgeMarketLabel("SE", current), /källa Yahoo Finance · snapshot hämtad 2026-11-14T03:35:14Z/);
});

test("excluded stale/unknown markets stay visibly unimported and never use calendar-age wording", () => {
  const stale = { ...current, actual: "2026-11-12", fresh: false, reason: "DATA_AS_OF_BEFORE_EXPECTED_SESSION" };
  const label = edgeMarketLabel("US", stale);
  assert.match(label, /inte importerad/);
  assert.match(label, /data är äldre än senaste avslutade handelsdag/);
  assert.match(label, /data 2026-11-12 · förväntad 2026-11-13/);
  assert.ok(!label.includes("kalenderdag"));
  assert.equal(edgeMarketLabel("US"), "US: status saknas");
});
