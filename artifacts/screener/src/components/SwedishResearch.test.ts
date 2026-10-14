import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { SwedishResearchContent } from "./SwedishResearch";
import { quoteLabels } from "../lib/researchQuote";
const pick = (id: number, direction: string, market = "SE") => ({ candidateId: id, ticker: `T${id}`, source: "edgeai", market, direction,
  category: "MOMENTUM", rank: id, score: 1, signalDate: "2026-10-09", entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2,
  decision: { status: "WAIT", reasons: [] } });
const selection: any = { sessionId: 7, date: "2026-10-09", kind: "RECOMMENDATION",
  revision: { revision: 2, available: true, selectedAt: "2026-10-09T10:00:00Z", sources: ["edgeai"],
    picks: [1, 2, 3, 4].map(i => pick(i, "LONG")).concat([pick(5, "SHORT"), pick(6, "LONG", "US")]) },
  dataDates: [{ source: "edgeai", signalDate: "2026-10-09", dataDate: "2026-10-08" }] };
const render = (props: any) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" },
  React.createElement(SwedishResearchContent, { selection, today: "2026-10-12", ...props })));
test("max 3 long + existing shorts only, no invented signals, US excluded from prominent surface", () => {
  const html = render({});
  assert.equal((html.match(/data-testid="research-card-/g) ?? []).length, 4);
  assert.ok(!html.includes("research-card-4") && !html.includes("research-card-6"));
  assert.ok(html.includes("Long 3/3 · Short 1/3"));
  assert.ok(html.includes("Köp / Long") && html.includes("Sälj / Short"));
});
test("saved fallback keeps date, STALE and its own dataDate; unknown EdgeAI metrics labelled, not fabricated", () => {
  const html = render({ signals: [{ id: 1, signalSource: "edgeai", signalDate: "2026-10-09", entryPrice: 100, stopPrice: 95, targetPrice: 110, edgeWinRate: 0.472 }] });
  for (const s of ["Session 2026-10-09", "STALE", "Datadag D−1 2026-10-08", "47.2%", "okänd", "Uppdatera priser", "Originalplan"]) assert.ok(html.includes(s), s);
  assert.ok(!html.includes(`data-entry-status="READY"`));
});
test("quote labels show actual quote fields, missing asOf is not verified, D-1 reference separate", () => {
  const q: any = { ticker: "T1", yahooTicker: "T1.ST", livePrice: 101.5, marketState: "REGULAR", asOf: null };
  assert.equal(quoteLabels(q)!.asOf, "Tidpunkt ej verifierad");
  assert.ok(quoteLabels(q)!.source.includes("T1.ST"));
  const html = render({ quotes: { T1: q } });
  for (const s of ["Tidpunkt ej verifierad", "REGULAR", "Yahoo Finance · T1.ST", "Planerad entry – inte stängningskurs"]) assert.ok(html.includes(s), s);
  assert.ok(quoteLabels({ ...q, asOf: "2026-10-12T08:00:00Z" })!.asOf.includes("Europe/Stockholm"));
});
test("pages mount exactly one prominent research surface; duplicates folded into disclosures", () => {
  for (const f of ["../pages/today.tsx", "../pages/dashboard.tsx"]) {
    const s = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal((s.match(/<SwedishResearch \/>/g) ?? []).length, 1);
    const saved = s.indexOf("<SavedTop3 />");
    assert.ok(s.lastIndexOf("<details", saved) > s.indexOf("<SwedishResearch />"));
  }
});

test("guard visible outside disclosure, entry not called close, invalid asOf not verified", () => {
  const q: any = { ticker: "T1", yahooTicker: "T1.ST", livePrice: 101, marketState: "REGULAR", asOf: "garbage" };
  assert.equal(quoteLabels(q)!.asOf, "Tidpunkt ej verifierad");
  const html = render({ quotes: { T1: q } });
  assert.ok(!html.includes("Invalid Date") && !html.includes("D−1-referens"));
  const card = readFileSync(new URL("./ResearchCard.tsx", import.meta.url), "utf8");
  const guard = card.indexOf("<LiveEntryGuard");
  assert.ok(guard > 0 && card.lastIndexOf("<details", guard) < 0);
  assert.ok(html.includes("data-entry-status="));
});

test("GETI-B quarantined saved plan stays visible with source-conflict warning and guard never READY", () => {
  const sel: any = { ...selection, revision: { ...selection.revision, picks: [{ ...pick(9, "LONG"), ticker: "GETI B" }] } };
  const report = { source: "edgeai", signalDate: "2026-10-09", reportDate: "2026-10-09", generatedAt: null, importedAt: "2026-10-09T08:00:00Z",
    fingerprint: "v2:q", status: "SUCCESS", dataDates: { SE: "2026-10-08", US: null }, warnings: ["GETI-B"],
    quarantinedIdentities: ["SE|MOMENTUM|GETI-B|LONG|2026-10-09|edgeai"] };
  const html = renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(SwedishResearchContent, {
    selection: sel, today: "2026-10-12", reports: [report],
    quotes: { "GETI B": { ticker: "GETI B", yahooTicker: "GETI-B.ST", livePrice: 100, marketState: "REGULAR", asOf: new Date().toISOString() } } })));
  assert.ok(html.includes("research-card-9"));
  assert.ok(html.includes("Källkonflikt – ingen entrybekräftelse"));
  assert.ok(html.includes('data-entry-status="UNKNOWN"'));
});
