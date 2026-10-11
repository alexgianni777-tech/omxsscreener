import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotePresentation } from "./QuotePresentation";
import { LiveEntryGuard } from "./LiveEntryGuard";
const render = (props: React.ComponentProps<typeof QuotePresentation>) => renderToStaticMarkup(React.createElement(QuotePresentation, props));
test("missing, malformed or fetched-only timestamps never imply a verified live quote", () => {
  for (const asOf of [null, undefined, "", "invalid"]) {
    const quote: any = { livePrice: 261.40, asOf, fetchedAt: "2026-10-11T08:00:00Z", marketState: "REGULAR" };
    const before = JSON.stringify(quote), s = render({ quote });
    assert.ok(s.includes("261,40")); assert.ok(s.includes("tidpunkt ej verifierad"));
    assert.ok(s.includes("inte verifierad livekurs")); assert.ok(s.includes("källa ej specificerad"));
    assert.ok(!s.includes("2026-10-11")); assert.equal(JSON.stringify(quote), before);
  }
});
test("existing asOf, source, stale status and D-1 distinction are visible without replacing any value", () => {
  const quote = { livePrice: 261.40, asOf: "2026-10-09T15:25:00Z", marketState: "CLOSED" };
  const s = render({ quote, source: "Yahoo Finance", status: "STALE_PRICE" });
  for (const expected of ["261,40", "2026-10-09 17:25:00", "Yahoo Finance", "CLOSED", "STALE_PRICE", "D−1", "ingen garanti"])
    assert.ok(s.includes(expected), expected);
  assert.equal(quote.livePrice, 261.40); assert.equal(quote.asOf, "2026-10-09T15:25:00Z");
});
test("mobile captions wrap and core short plan assessment remains visible, not hidden in details", () => {
  const s = renderToStaticMarkup(React.createElement(LiveEntryGuard, {
    plan: { direction: "SHORT", entryPrice: 100, stopPrice: 105, targetPrice: 90, rr: 2 },
    quote: { livePrice: 99, asOf: "2026-10-02T11:59:00Z", marketState: "REGULAR" },
    now: Date.parse("2026-10-02T12:00:00Z"),
  }));
  assert.ok(s.includes("min-w-0")); assert.ok(s.includes("break-words"));
  assert.ok(s.includes('data-entry-status="READY"')); assert.ok(s.includes("original: 2,00")); assert.ok(s.includes("aktuellt: 1,50"));
  assert.ok(s.indexOf("Aktuellt R/R: 1,50") < s.indexOf("<details"));
  assert.ok(!s.includes("min-w-[320px]"));
});
test("UNKNOWN has one compact always-visible missing-price warning; diagnostics stay in closed details", () => {
  const plan = { direction: "LONG", entryPrice: 43.66, stopPrice: 42.05, targetPrice: 47.7, rr: 2.50931677018634 };
  const before = JSON.stringify(plan);
  const s = renderToStaticMarkup(React.createElement(LiveEntryGuard, { plan, quote: null }));
  const visible = s.slice(0, s.indexOf("<details"));
  assert.ok(s.includes('data-entry-status="UNKNOWN"'));
  assert.equal((visible.match(/Livekurs saknas – ingen entrybekräftelse/g) ?? []).length, 1);
  assert.ok(!visible.includes("R/R original")); assert.ok(!visible.includes("Ingen genomförbar"));
  assert.ok(!s.includes("<details open")); assert.ok(s.includes("Visa detaljer"));
  for (const text of ["asOf", "TRADEABLE = screeningstatus", "aktuellt R/R ≥1,2", "Originalförslag och screeningstatus bevaras"])
    assert.ok(s.includes(text), text);
  assert.ok(s.includes("original: 2,51")); assert.ok(!s.includes("2.50931677018634"));
  assert.equal(JSON.stringify(plan), before);
});
