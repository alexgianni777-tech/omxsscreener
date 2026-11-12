import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioRiskPanel } from "./PortfolioRiskPanel";
import { JournalAnalysis } from "./JournalAnalysis";
import { EntrySafety } from "./EntrySafety";
import { DataFreshness } from "./DataFreshness";
const html = (component: any, props: any) => renderToStaticMarkup(React.createElement(component, props));
const now = Date.parse("2026-10-02T12:00:00Z");
test("portfolio safety shows recorded capital, partial/unknown totals, banks and non-guaranteed stop vs knockout without claiming correlation", () => {
  const base: any = { id: 1, ticker: "C", entryPrice: 100, shares: 10, positionSizeKr: 1000, stopPrice: 95, direction: "LONG", productType: "SHARE" };
  const s = html(PortfolioRiskPanel, { now, positions: [base, { ...base, id: 2, ticker: "BAC", instrument: "MINI S BAC",
    productType: "MINI", productSide: null, indicativeLeverage: null, quoteAsOf: null }] });
  for (const text of ["Koncentrerad sektorexponering", "faktisk korrelation", "total okänd", "faktisk SEK-insats", "Knockout", "Helg-/kursgap", "ålder okänd"])
    assert.ok(s.includes(text), text);
  assert.ok(s.includes("sm:grid-cols"));
});
test("journal view gives unknown actual fields, no legacy/simulated mixing, missing-series MFE/MAE and no fake win rate", () => {
  const s = html(JournalAnalysis, { now, records: [{ id: "unfilled", input: { mode: "REAL" }, metrics: { netR: 2 },
    signal: { ticker: "C", entryPrice: 100, stopPrice: 95, targetPrice: 110 } }] });
  for (const text of ["0 verifierade", "1 exkluderade", "MFE/MAE: ej tillgängligt", "Brutto-P", "netto-R okänt", "inga uppskattningar", "okänt"])
    assert.ok(s.includes(text), text);
  assert.ok(!s.includes("netto-R 2"));
  assert.ok(s.includes("md:grid-cols-2"));
});
test("date evidence distinguishes successful receipt from manual/unverified dates and warns without altering originals", () => {
  const verified = html(DataFreshness, { reportDate: "2026-10-09", dataDate: "2026-10-08", today: "2026-10-12",
    source: "edgeai", receiptVerified: true });
  assert.ok(verified.includes("3 kalenderdagar")); assert.ok(verified.includes("4 kalenderdagar"));
  assert.ok(verified.includes("inte extern bekräftelse")); assert.ok(verified.includes("D−1/prev close"));
  const manual = html(DataFreshness, { reportDate: "2026-10-13", today: "2026-10-12", source: "manuell", manual: true, event: true });
  assert.ok(manual.includes("om 1 kalenderdagar")); assert.ok(manual.includes("ej externt verifierat"));
  const missing = html(EntrySafety, { plan: { direction: "SHORT", entryPrice: 100, stopPrice: 105, targetPrice: 90 }, quote: null, now });
  assert.ok(missing.includes("Kursålder")); assert.ok(missing.includes("okänd")); assert.ok(missing.includes("endast varning"));
  assert.ok(!missing.includes("disabled"));
});
