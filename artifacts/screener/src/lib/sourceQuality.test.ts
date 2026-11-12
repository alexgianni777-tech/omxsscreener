import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchCard } from "../components/ResearchCard";
import { LiveEntryGuard } from "../components/LiveEntryGuard";
import { sourceQualityReasons } from "./sourceQuality";

test("legacy unknown and WATCH/RESEARCH_ONLY prevent READY with otherwise fresh long/short prices", (context) => {
  context.mock.timers.enable({apis:["Date"],now:Date.parse("2026-11-04T15:00:00Z")});
  for (const direction of ["LONG", "SHORT"] as const) {
    const pick: any = { candidateId: 1, ticker: "TEST", market: "US", direction, source: "edgeai",
      signalDate: "2026-11-03", category: direction === "LONG" ? "MOMENTUM" : "WEAKEST",
      entryPrice: 100, stopPrice: direction === "LONG" ? 95 : 105, targetPrice: direction === "LONG" ? 110 : 90, rr: 2,
      decision: { status: "TRADEABLE" } };
    const quality: any = { source: "edgeai", evidenceStatus: "WATCH", eliteStatus: "RESEARCH_ONLY",
      eliteQualified: false, validatedEdge: false, dataAsOf: "2026-11-03", entryEligible: false,
      fullSessionVerified: false, barSource: "UNKNOWN", reasons: ["RESEARCH ONLY – upstream kvalificerar inte."] };
    const quote: any = { livePrice: 100, asOf: new Date().toISOString(), marketState: "REGULAR", yahooTicker: "TEST" };
    for (const dataQuality of [null, quality]) {
      const signal: any = { id: 1, ...pick, signalSource: "edgeai", dataQuality, earningsKnowledge: "SIGNAL_TIME", earningsInDays: 10 };
      const card = renderToStaticMarkup(React.createElement(ResearchCard, { pick, signal, quote, dataDate: "2026-11-03" }));
      assert.ok(card.includes("BLOCKERAD"));
      assert.ok(!card.includes("READY – entryvillkor"));
      const guard = renderToStaticMarkup(React.createElement(LiveEntryGuard, { plan: pick, signal, quote }));
      assert.ok(guard.includes('data-entry-status="UNKNOWN"'));
      assert.ok(!guard.includes('data-entry-status="READY"'));
      if (dataQuality) assert.ok(card.includes("WATCH") && card.includes("eliteQualified: false"));
    }
  }
});

test("unverified reconstruction is not eligible even when a stored eligibility flag is accidentally true", () => {
  assert.equal(sourceQualityReasons("telegram", {
    source: "telegram", dataAsOf: "2026-11-03", evidenceStatus: null, eliteStatus: null,
    eliteQualified: null, validatedEdge: null, barSource: "RECONSTRUCTED_INTRADAY",
    fullSessionVerified: false, entryEligible: true, reasons: [],
  }).length, 1);
});
