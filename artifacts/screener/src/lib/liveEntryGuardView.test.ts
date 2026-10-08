import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveEntryGuard } from "../components/LiveEntryGuard";

const now = Date.parse("2026-10-02T12:00:00Z");
const plan = { direction: "SHORT", entryPrice: 100, stopPrice: 105, targetPrice: 90, rr: 2 };
test("entry view renders separate status, both R/Rs, exact quote provenance and signal metadata", () => {
  const html = renderToStaticMarkup(createElement(LiveEntryGuard, {
    plan, now,
    quote: { livePrice: 99, asOf: "2026-10-02T11:59:00Z", marketState: "REGULAR" },
    signal: { signalDate: "2026-10-01", signalSource: "edgeai", signalAgeBars: 3 },
  }));
  for (const expected of [
    'data-entry-status="READY"', "original: 2.00", "aktuellt: 1.50",
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
    assert.ok(html.includes("Setupålder okänd"));
  }
});
