import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { SwedishResearchContent } from "./SwedishResearch";
import { ResearchCard } from "./ResearchCard";
import { qualifiedEdgeQuality } from "../lib/sourceQuality.fixtures";

const pick: any = { candidateId: 1, ticker: "DEMO", market: "SE", direction: "LONG",
  source: "edgeai", category: "MOMENTUM", rank: 1, signalDate: "2026-04-02",
  entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2, decision: { status: "TRADEABLE", reasons: [] } };
function content(today: string, dataDate: string | null, signalDate = dataDate, market = "SE") {
  const p = { ...pick, signalDate, market };
  const selection: any = { date: signalDate, sessionId: 1, kind: "RECOMMENDATION",
    revision: { revision: 1, picks: [p] }, dataDates: [{ source: "edgeai", signalDate, market, dataDate }] };
  return renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" },
    React.createElement(SwedishResearchContent, { selection, today })));
}
test("saved D−1 is not globally STALE just because the session date is earlier, across holidays and weekends", () => {
  for (const [today, date, market] of [
    ["2026-11-05", "2026-11-04", "SE"], ["2026-11-02", "2026-10-30", "SE"],
    ["2026-04-07", "2026-04-02", "SE"], ["2026-11-27", "2026-11-25", "US"],
  ]) {
    const html = content(today, date, date, market);
    assert.ok(!html.includes('data-testid="status-research-stale"'), `${market} ${today}`);
    assert.ok(!html.includes("STALE · historiskt urval"));
    assert.ok(html.includes(date));
  }
});
test("unknown, unverified calendar and old market data cannot become active D−1 or READY", () => {
  for (const html of [content("2026-11-05", null, "2026-11-05"),
    content("2028-01-05", "2028-01-04"), content("2026-11-05", "2026-11-02")]) {
    assert.ok(html.includes("NO DATA") || html.includes("STALE"));
    assert.ok(!html.includes("Aktuell D−1-signal"));
    assert.ok(!html.includes("READY – entryvillkor"));
  }
});
test("missing manual earnings check is a neutral notice, not an automatic blocker, for LONG and SHORT", () => {
  for (const direction of ["LONG", "SHORT"]) {
    const p = { ...pick, direction, stopPrice: direction === "LONG" ? 95 : 105, targetPrice: direction === "LONG" ? 110 : 90 };
    const signal: any = { id: 1, ...p, signalSource: "edgeai", dataQuality: qualifiedEdgeQuality,
      earningsKnowledge: "UNKNOWN", earningsInDays: null };
    const quote: any = { livePrice: 100, asOf: new Date().toISOString(), marketState: "REGULAR", yahooTicker: "DEMO.ST" };
    const before = JSON.stringify({ p, signal });
    const html = renderToStaticMarkup(React.createElement(ResearchCard, {
      pick: p, signal, quote, dataDate: "2026-04-02", dataDateStatus: "CURRENT",
    }));
    assert.ok(html.includes("READY – entryvillkor verifierade, inte en order"));
    assert.ok(html.includes("Rapportkalender kontrolleras manuellt före orderläggning"));
    assert.ok(!html.includes("Rapportdatum ej verifierat – kontrollera manuellt"));
    assert.ok(!html.includes("BLOCKERAD"));
    assert.equal(JSON.stringify({ p, signal }), before);
  }
});
test("manual earnings policy never bypasses date conflict, missing price or source disqualification", () => {
  for (const props of [
    { dataDateStatus: "UNKNOWN" }, { dataDateStatus: "CONFLICT" }, { quote: undefined },
    { signal: { id: 1, ...pick, dataQuality: { ...qualifiedEdgeQuality, eliteQualified: false, entryEligible: false } } },
  ]) {
    const html = renderToStaticMarkup(React.createElement(ResearchCard, {
      pick, signal: { id: 1, ...pick, dataQuality: qualifiedEdgeQuality }, dataDate: "2026-04-02",
      quote: { livePrice: 100, asOf: new Date().toISOString(), marketState: "REGULAR", yahooTicker: "DEMO.ST" } as any,
      ...props,
    } as any));
    assert.ok(!html.includes("READY – entryvillkor"));
  }
});
