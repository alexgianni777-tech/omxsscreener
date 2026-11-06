import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionSourceReport } from "@workspace/api-client-react";
import { SourceProvenance } from "../components/SourceProvenance";
import { SourceMarketEvidence } from "../components/SourceMarketEvidence";
import { advisoryTrend, trendAlignment } from "./sourceMarketEvidence";
import { quoteLabels } from "./researchQuote";

const now = new Date("2026-11-06T12:00:00Z");
const receipt = (source: string): SessionSourceReport => ({
  source, status: "SUCCESS", fingerprint: source, signalDate: "2026-11-06", reportDate: "2026-11-06",
  generatedAt: null, importedAt: "2026-11-06T08:00:00Z",
  dataDates: { SE: "2026-11-05", US: source === "edgeai" ? "2026-11-05" : null },
});
const edge = (): SessionSourceReport => ({ ...receipt("edgeai"), marketContext: {
  SE: { dataAsOf: "2026-11-05",
    indexSnapshot: { close: 3301.09, asOf: "2026-11-05", source: "YAHOO_FINANCE", priceType: "COMPLETED_DAILY_CLOSE", fetchedAt: "2026-11-06T08:00:00Z" },
    marketTrendV2: { status: "BULLISH", dataAsOf: "2026-11-05", direction: "UP", breadth: { aboveSma50Pct: 65 }, stress: false } },
  US: { dataAsOf: "2026-11-05", marketTrendV2: { status: "BEARISH", dataAsOf: "2026-11-05" } },
}});
test("same SE market day compares independently of report day and Telegram has no US comparison", () => {
  const reports = [receipt("telegram"), { ...edge(), reportDate: "2026-11-05" }];
  const html = renderToStaticMarkup(React.createElement(SourceProvenance, { reports }));
  for (const text of ["Sveriges datadag överensstämmer", "Olika rapportdatum", "amerikansk marknadsdag tillhandahålls inte", "USA-synkning jämförs inte"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("inte datumssynkroniserade"));
});
test("source snapshot is clearly historical; mismatched index date never shows a verified close", () => {
  const report = edge();
  let html = renderToStaticMarkup(React.createElement(SourceMarketEvidence, { receipt: report }));
  for (const text of ["ej live", "3 301,09", "2026-11-05", "YAHOO_FINANCE", "RESEARCH ONLY"]) assert.ok(html.includes(text), text);
  report.marketContext!.SE!.indexSnapshot!.asOf = "2026-11-04";
  html = renderToStaticMarkup(React.createElement(SourceMarketEvidence, { receipt: report }));
  assert.ok(html.includes("CONFLICT/ej verifierad indexsnapshot"));
  assert.ok(!html.includes("3 301,09"));
});
test("advisory trend is per market and same-day only; absent/stale/failed/conflicting evidence waits", () => {
  const report = edge();
  const before = JSON.stringify(report);
  assert.equal(advisoryTrend([report], "SE", now).status, "BULLISH");
  assert.equal(advisoryTrend([report], "US", now).status, "BEARISH");
  assert.equal(trendAlignment([report], "SE", "LONG", "2026-11-05", now), "med trend");
  assert.equal(trendAlignment([report], "US", "LONG", "2026-11-05", now), "mot trend");
  assert.equal(trendAlignment([report], "SE", "LONG", "2026-11-04", now), "avvakta");
  assert.equal(advisoryTrend([report], "SE", new Date("2026-11-10T12:00:00Z")).status, "UNKNOWN");
  assert.equal(advisoryTrend([receipt("edgeai")], "SE", now).status, "UNKNOWN");
  assert.equal(advisoryTrend([{ ...report, status: "FAILED" }], "SE", now).status, "UNKNOWN");
  assert.equal(JSON.stringify(report), before);
  report.marketContext!.SE!.marketTrendV2!.dataAsOf = "2026-11-04";
  assert.equal(advisoryTrend([report], "SE", now).status, "UNKNOWN");
});
test("all advisory regimes are explicit; STRESS/NEUTRAL/UNKNOWN never imply entry approval", () => {
  for (const state of ["BULLISH", "BEARISH", "NEUTRAL", "STRESS", "UNKNOWN", "BUY_NOW"]) {
    const report = edge();
    report.marketContext!.SE!.marketTrendV2!.status = state;
    assert.equal(advisoryTrend([report], "SE", now).status, state === "BUY_NOW" ? "UNKNOWN" : state);
    if (!["BULLISH", "BEARISH"].includes(state)) assert.equal(trendAlignment([report], "SE", "LONG", "2026-11-05", now), "avvakta");
  }
});
test("Yahoo quote uses actual source clock, never fetchedAt or plan; stale/missing/closed is unknown current price", () => {
  const quote = { ticker: "TEST", yahooTicker: "TEST.ST", livePrice: 123.45, asOf: "2026-11-06T11:59:00Z", fetchedAt: now.toISOString(), marketState: "REGULAR" } as any;
  const before = JSON.stringify(quote);
  assert.equal(quoteLabels(quote, now.getTime())!.price, "123,45");
  for (const q of [
    { ...quote, asOf: null }, { ...quote, asOf: "2026-11-06" },
    { ...quote, asOf: "2026-11-05T12:00:00Z" }, { ...quote, marketState: "CLOSED" },
    { ...quote, asOf: "2026-11-06T13:00:00Z" },
  ]) assert.equal(quoteLabels(q, now.getTime())!.price, "Kurs ej verifierad");
  assert.equal(quoteLabels({ ...quote, asOf: null }, now.getTime())!.asOf, "Tidpunkt ej verifierad");
  assert.ok(quoteLabels({ ...quote, asOf: "2026-11-05T12:00:00Z" }, now.getTime())!.status.includes("STALE"));
  assert.equal(JSON.stringify(quote), before);
});
