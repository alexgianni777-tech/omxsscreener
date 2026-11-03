import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { SwedishResearchContent, allowPreliminaryResearch } from "./SwedishResearch";
import { quoteLabels, researchQuoteForMarket } from "../lib/researchQuote";
import { ResearchCard } from "./ResearchCard";
import { ResearchMarketSections, marketEvidence } from "./ResearchMarketSections";
import { savedDataDate } from "../lib/researchQuote";
const pick = (id: number, direction: string, market = "SE") => ({ candidateId: id, ticker: `T${id}`, source: "edgeai", market, direction,
  category: "MOMENTUM", rank: id, score: 1, signalDate: "2026-10-09", entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2,
  decision: { status: "WAIT", reasons: [] } });
const selection: any = { sessionId: 7, date: "2026-10-09", kind: "RECOMMENDATION",
  revision: { revision: 2, available: true, selectedAt: "2026-10-09T10:00:00Z", sources: ["edgeai"],
    picks: [1, 2, 3, 4].map(i => pick(i, "LONG")).concat([pick(5, "SHORT"), pick(6, "LONG", "US")]) },
  dataDates: [{ source: "edgeai", signalDate: "2026-10-09", dataDate: "2026-10-08" }] };
const render = (props: any) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" },
  React.createElement(SwedishResearchContent, { selection, today: "2026-10-12", ...props })));
test("failed or unfinished saved-selection lookup cannot promote preliminary research", () => {
  assert.equal(allowPreliminaryResearch(false, null), false);
  assert.equal(allowPreliminaryResearch(false, undefined), false);
  assert.equal(allowPreliminaryResearch(true, undefined), false);
  assert.equal(allowPreliminaryResearch(true, selection), false);
  assert.equal(allowPreliminaryResearch(true, null), true);
});
test("comparison of alternative plans does not replace a usable quote with a fabricated import error", () => {
  const now = new Date();
  const signalDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(now);
  const html = renderToStaticMarkup(React.createElement(ResearchCard, {
    pick: { ...pick(1, "LONG"), signalDate }, dataDate: signalDate,
    warnings: ["Flera planer/riktningar för aktien – jämför innan beslut"],
    quote: { ticker: "T1", yahooTicker: "T1.ST", livePrice: 100,
      marketState: "REGULAR", asOf: now.toISOString() } as any,
  }));
  assert.ok(html.includes("Flera planer/riktningar"));
  assert.ok(html.includes('data-entry-status="UNKNOWN"'));
  assert.ok(html.includes("NO TRADE · ingen entrybekräftelse"));
  assert.ok(html.includes("NO TRADE · ingen entrybekräftelse"));
});

test("decision brief fails closed on missing market date, stale data, non-TRADEABLE screening and missing quote", () => {
  const html = renderToStaticMarkup(React.createElement(ResearchCard, {
    pick: pick(20, "LONG"), dataDate: null, stale: true,
  }));
  assert.ok(html.includes("NO TRADE · ingen entrybekräftelse"));
  assert.ok(html.includes("Screeningstatus är inte verifierat TRADEABLE"));
  assert.ok(html.includes("Signal eller marknadsdag är STALE"));
  assert.ok(html.includes("Verifierat marknadsdatadatum saknas"));
  assert.ok(html.includes("Rapportdatum ska kontrolleras manuellt före beslut"));
  assert.ok(!html.includes('data-entry-status="READY"'));
});
test("a US Yahoo symbol cannot be shown as a verified current price for a Swedish EQT plan", () => {
  const quote: any = { ticker: "EQT", yahooTicker: "EQT", livePrice: 53.82,
    marketState: "REGULAR", asOf: new Date().toISOString() };
  const original = JSON.stringify(quote);
  const checked = researchQuoteForMarket("SE", quote);
  assert.equal(checked!.livePrice, 53.82);
  assert.ok(checked!.error?.includes("Stockholmsmarknad"));
  assert.equal(quoteLabels(checked)!.price, "Kurs ej verifierad");
  assert.equal(JSON.stringify(quote), original);
  assert.equal(researchQuoteForMarket("US", quote), quote);
  const swedish = { ...quote, yahooTicker: "EQT.ST" };
  assert.equal(researchQuoteForMarket("SE", swedish), swedish);
  assert.ok(researchQuoteForMarket("US", swedish)?.error?.includes("för USA"));
  assert.equal(researchQuoteForMarket("US", swedish)?.livePrice, swedish.livePrice);
  const sel = { ...selection, revision: { ...selection.revision, picks: [{
    ...pick(8, "SHORT"), ticker: "EQT", entryPrice: 289.5, stopPrice: 296.48, targetPrice: 272.04,
  }] } };
  const html = render({ selection: sel, quotes: { EQT: quote } });
  assert.ok(html.includes("Kurs ej verifierad"));
  assert.ok(html.includes("Yahoo-symbol EQT"));
  assert.ok(html.includes('data-entry-status="UNKNOWN"'));
  assert.ok(!html.includes("53,82"));
});
test("both markets are prominent, max 3 per side, and all four groups remain visible", () => {
  const html = render({});
  assert.equal((html.match(/data-testid="research-card-/g) ?? []).length, 5);
  assert.ok(!html.includes("research-card-4") && html.includes("research-card-6"));
  assert.ok(html.includes("Long 3/3 · Short 1/3"));
  assert.ok(html.includes("Köp / Long") && html.includes("Sälj / Short"));
  for (const market of ["SE", "US"]) for (const direction of ["LONG", "SHORT"])
    assert.ok(html.includes(`data-testid="research-${market}-${direction}"`));
});
test("November 3 US empty sections explain October 30 signal and market dates without promoting old cases", () => {
  const reports: any[] = [{ source: "edgeai", status: "SUCCESS", reportDate: "2026-11-02",
    importedAt: "2026-11-03T08:58:08Z", dataDates: { SE: "2026-11-02", US: "2026-10-30" } }];
  const signals = [{ market: "US", direction: "LONG", signalDate: "2026-10-30" },
    { market: "US", direction: "SHORT", signalDate: "2026-10-29" }];
  const evidence = marketEvidence("US", "LONG", signals, reports, "2026-11-03");
  assert.equal(evidence.blockedDates, 1);
  assert.equal(evidence.staleData, true);
  assert.equal(evidence.newestSignal, "2026-10-30");
  const html = renderToStaticMarkup(React.createElement(ResearchMarketSections, {
    picks: [], signals, reports, sessionDate: "2026-11-03", renderPick: () => null,
  }));
  assert.ok(html.includes("empty-US-LONG") && html.includes("empty-US-SHORT"));
  assert.ok(html.includes("2026-10-30") && html.includes("2026-11-02") && html.includes("Datumspärr"));
  assert.ok(html.includes("STALE") && html.includes("NO TRADE"));
  assert.ok(!html.includes("TRADEABLE") && !html.includes('data-entry-status="READY"'));
});
test("previous-weekday dates remain valid across a weekend; unknown/future signal dates stay blocked", () => {
  const reports: any[] = [{ source: "edgeai", status: "SUCCESS", dataDates: { US: "2026-10-30" } }];
  assert.equal(marketEvidence("US", "LONG", [{ market: "US", direction: "LONG", signalDate: "2026-10-30" }], reports, "2026-11-02").blockedDates, 0);
  const result = marketEvidence("US", "SHORT", [
    { market: "US", direction: "SHORT", signalDate: null },
    { market: "US", direction: "SHORT", signalDate: "2026-11-04" },
  ], reports, "2026-11-03");
  assert.equal(result.blockedDates, 2);
});
test("US and SE data days cannot be borrowed from each other in a shared source report", () => {
  const dates = [{ source: "edgeai", signalDate: "2026-11-02", market: "SE", dataDate: "2026-11-02" },
    { source: "edgeai", signalDate: "2026-11-02", market: "US", dataDate: "2026-10-30" }];
  assert.equal(savedDataDate(dates, "edgeai", "2026-11-02", "SE"), "2026-11-02");
  assert.equal(savedDataDate(dates, "edgeai", "2026-11-02", "US"), "2026-10-30");
  assert.equal(savedDataDate([dates[0]], "edgeai", "2026-11-02", "US"), null);
  assert.equal(savedDataDate([{ source: "edgeai", signalDate: "2026-11-02", dataDate: "2026-11-02" }], "edgeai", "2026-11-02", "US"), null);
});
test("old US and SE saved TRADEABLE statuses are historical, never verified entry", () => {
  for (const market of ["US", "SE"]) {
    const html = renderToStaticMarkup(React.createElement(ResearchCard, {
      pick: { ...pick(30, "LONG", market), decision: { status: "TRADEABLE", reasons: [] } },
      dataDate: "2026-10-30", stale: true,
    }));
    assert.ok(html.includes("STALE · historiskt urval"));
    assert.ok(!html.includes("TRADEABLE · screening") && !html.includes('data-entry-status="READY"'));
    assert.ok(html.includes("NO TRADE"));
  }
});
test("latest-session source status is separate from the saved selection's signal evidence", () => {
  const latestReceipt: any = {
    source: "edgeai", status: "SUCCESS", reportDate: "2026-10-12", signalDate: "2026-10-12",
    importedAt: "2026-10-12T08:05:00Z", dataDates: { SE: "2026-10-09", US: "2026-10-09" },
    fingerprint: "latest", warnings: [],
  };
  const html = render({ statusReports: [latestReceipt], reports: [] });
  assert.ok(html.includes("Källstatus · senaste kvitton per källa"));
  assert.ok(html.includes("Rapportdatum 2026-10-12"));
  assert.ok(html.includes("Marknadsdag SE 2026-10-09 / USA 2026-10-09"));
  assert.ok(html.includes("Senast lyckad import"));
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
test("today is the single prominent research surface; historical dashboard stays separate", () => {
  const home = readFileSync(new URL("../pages/today.tsx", import.meta.url), "utf8");
  assert.equal((home.match(/<SwedishResearch\b/g) ?? []).length, 1);
  assert.ok(home.includes("latestReports={session?.sourceReports ?? []}"));
  const saved = home.indexOf("<SavedTop3 />");
  assert.ok(home.lastIndexOf("<details", saved) > home.indexOf("<SwedishResearch />"));

  const history = readFileSync(new URL("../pages/dashboard.tsx", import.meta.url), "utf8");
  assert.equal((history.match(/<SwedishResearch\b/g) ?? []).length, 0);
  assert.ok(history.includes("Historiska utfall"));
  assert.ok(history.includes('data-testid="details-current-selection"'));
  assert.ok(history.includes('data-testid="details-historical-stats"'));
});

test("guard visible outside disclosure, entry not called close, invalid asOf not verified", () => {
  const q: any = { ticker: "T1", yahooTicker: "T1.ST", livePrice: 101, marketState: "REGULAR", asOf: "garbage" };
  assert.equal(quoteLabels(q)!.asOf, "Tidpunkt ej verifierad");
  const html = render({ quotes: { T1: q } });
  assert.ok(!html.includes("Invalid Date") && !html.includes("D−1-referens"));
  const card = readFileSync(new URL("./ResearchCard.tsx", import.meta.url), "utf8");
  const guard = card.indexOf("<LiveEntryGuard");
  const beforeGuard = card.slice(0, guard);
  assert.ok(guard > 0);
  assert.equal((beforeGuard.match(/<details\b/g) ?? []).length, (beforeGuard.match(/<\/details>/g) ?? []).length);
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
