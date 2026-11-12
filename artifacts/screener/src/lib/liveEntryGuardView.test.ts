import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveEntryGuard } from "../components/LiveEntryGuard";
import { qualifiedEdgeQuality } from "./sourceQuality.fixtures";

const now = Date.parse("2026-10-02T12:00:00Z");
const plan = { direction: "SHORT", entryPrice: 100, stopPrice: 105, targetPrice: 90, rr: 2 };
test("entry view renders separate status, both R/Rs, exact quote provenance and signal metadata", () => {
  const html = renderToStaticMarkup(createElement(LiveEntryGuard, {
    plan, now,
    quote: { livePrice: 99, asOf: "2026-10-02T11:59:00Z", marketState: "REGULAR" },
    // Price-rendering test: complete qualification is supplied by the caller.
    // Its full rules are exercised in assetScreenV2.test.ts.
    signal: { signalDate: "2026-10-01", signalSource: "edgeai", signalAgeBars: 3, dataQuality: qualifiedEdgeQuality,
      qualification:{status:"QUALIFIED",reasons:[]} },
  }));
  for (const expected of [
    'data-entry-status="UNKNOWN"', "BOARD REVIEW REQUIRED", "original: 2,00", "aktuellt: 1,50",
    "2026-10-02 13:59:00", "Rapport 2026-10-01", "edgeai", "3 bars vid rapporten",
    "TRADEABLE = screeningstatus, inte live-entrybesked",
  ]) assert.ok(html.includes(expected), `missing ${expected}`);
});
test("closed or unverified price shows unknown current R/R, not a cached entry approval", () => {
  for (const quote of [
    { livePrice: 99, asOf: "2026-10-02T11:59:00Z", marketState: "CLOSED" },
    { livePrice: 99, marketState: "REGULAR" },
  ]) {
    const html = renderToStaticMarkup(createElement(LiveEntryGuard, { plan, quote, now }));
    assert.ok(html.includes("aktuellt: okänt"));
    assert.ok(!html.includes('data-entry-status="READY"'));
    assert.ok(html.includes("Ingen genomförbar live-entry."));
    assert.ok(html.includes("Setupålder okänd"));
  }
});
test("missed entry and broken plans are explicitly not presented as executable", () => {
  for (const price of [98, 90, 105]) {
    const html = renderToStaticMarkup(createElement(LiveEntryGuard, {
      plan, now, quote: { livePrice: price, asOf: "2026-10-02T11:59:00Z", marketState: "REGULAR" },
    }));
    assert.ok(html.includes("Ingen genomförbar live-entry."));
    assert.ok(!html.includes('data-entry-status="READY"'));
  }
});
