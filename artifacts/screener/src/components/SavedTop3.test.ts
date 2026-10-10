import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { SavedTop3Content } from "./SavedTop3";
import { currentSavedRevision } from "../lib/persistentTop3Display";
const revision: any = { revision: 1, displayEligible: true, available: true, selectedAt: "2026-10-09T10:00:00Z",
  sources: ["edgeai", "telegram"], picks: [{ candidateId: 1, ticker: "TEST", source: "edgeai",
    market: "SE", direction: "LONG", signalDate: "2026-10-09", entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2 }] };
test("new empty, partial and automatic-only versions retain the last valid current recommendation", () => {
  const rows = [revision, { ...revision, revision: 2, picks: [] },
    { ...revision, revision: 3, sources: ["edgeai"] },
    { ...revision, revision: 4, displayEligible: false }];
  const before = JSON.stringify(rows);
  assert.equal(currentSavedRevision(rows), revision);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(currentSavedRevision([{ ...revision, picks: [] }]), undefined);
});
test("saved list survives weekend/holiday display, shows real signal/data dates, original plan and no fresh-entry claim", () => {
  const html = renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(SavedTop3Content, { today: "2026-10-12", selection: {
    sessionId: 1, date: "2026-10-09", kind: "RECOMMENDATION", revision,
    dataDates: [{ source: "edgeai", signalDate: "2026-10-09", dataDate: "2026-10-08" }],
  } })));
  for (const s of ["STALE", "ej nytt köp", "2026-10-09", "2026-10-08", "Entry 100", "Stop 95", "TP 110"]) assert.ok(html.includes(s), s);
  assert.ok(!html.includes("READY"));
});
