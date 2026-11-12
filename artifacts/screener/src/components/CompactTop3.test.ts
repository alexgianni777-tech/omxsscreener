import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { CurrentTop3Selection } from "./CurrentTop3Selection";
import { PlanGrid } from "./PlanGrid";

test("NIBE/SCA mobile presentation rounds only display, keeps plan before compact UNKNOWN and preserves help", () => {
  const revision: any = {
    revision: 1, available: true, displayEligible: true, policyVersion: "official-top3-v7",
    selectedAt: "2026-10-08T14:00:00Z", sources: ["edgeai", "telegram"],
    picks: [
      { candidateId: 1, ticker: "NIBE-B.ST", rank: 1, entryPrice: 43.66, stopPrice: 42.05, targetPrice: 47.7, rr: 2.50931677018634 },
      { candidateId: 2, ticker: "SCA-B.ST", rank: 2, entryPrice: 118.2, stopPrice: 115.56, targetPrice: 122.59, rr: 1.66287878787878 },
    ].map(p => ({ ...p, market: "SE", direction: "LONG", source: "edgeai", signalDate: "2026-10-08",
      decision: { status: "TRADEABLE", reasons: ["Manuell rapportkontroll före trade."] } })),
  };
  const before = JSON.stringify(revision);
  const html = renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" },
    React.createElement(CurrentTop3Selection, { revisions: [revision], sessionId: 1, quotes: {} })));
  const closed = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
  for (const n of ["43,66", "42,05", "47,70", "2,51", "118,20", "115,56", "122,59", "1,66"])
    assert.ok(closed.includes(n), n);
  assert.ok(!html.includes("2.50931677018634")); assert.ok(!html.includes("1.66287878787878"));
  assert.equal((closed.match(/Livekurs saknas – ingen entrybekräftelse/g) ?? []).length, 2);
  assert.ok(closed.includes("STALE")); assert.ok(closed.includes("screeningstatus, inte entrybekräftelse"));
  assert.ok(!closed.includes("Aktuell entry kan inte verifieras"));
  assert.ok(html.includes("asOf")); assert.ok(html.includes("Chase guard")); assert.ok(html.includes("Manuell rapportkontroll"));
  assert.ok(html.indexOf('aria-label="R/R 2,51"') < html.indexOf('data-testid="live-entry-guard"'));
  assert.equal(JSON.stringify(revision), before);
});
test("plan formatting handles missing/non-finite values and never clips a larger financial value", () => {
  const html = renderToStaticMarkup(React.createElement(PlanGrid, { plan: {
    entryPrice: 123456789.125, stopPrice: NaN, targetPrice: Infinity, rr: null,
  } }));
  assert.ok(html.includes("okänt")); assert.ok(!html.includes("NaN")); assert.ok(!html.includes("Infinity"));
  assert.ok(html.includes("overflow-wrap:anywhere")); assert.ok(!html.includes("truncate"));
});
