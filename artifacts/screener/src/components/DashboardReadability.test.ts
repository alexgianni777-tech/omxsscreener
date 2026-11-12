import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchCard } from "./ResearchCard";
import { SourceProvenance } from "./SourceProvenance";
import type { SessionSourceReport } from "@workspace/api-client-react";
import { qualifiedEdgeQuality } from "../lib/sourceQuality.fixtures";

function visibleWhenClosed(html: string): string {
  const stack: { open: boolean; summary: boolean }[] = [];
  return html.split(/(<\/?(?:details|summary)\b[^>]*>)/g).map(part => {
    if (/^<details\b/.test(part)) { stack.push({ open: /\sopen(?:\s|=|>)/.test(part), summary: false }); return ""; }
    if (/^<\/details/.test(part)) { stack.pop(); return ""; }
    if (/^<summary\b/.test(part)) { if (stack.length) stack.at(-1)!.summary = true; return ""; }
    if (/^<\/summary/.test(part)) { if (stack.length) stack.at(-1)!.summary = false; return ""; }
    return stack.every(s => s.open || s.summary) ? part : "";
  }).join("");
}

test("historical research plan precedes thesis/statistics; unknown live entry and original values stay visible", (context) => {
  context.mock.timers.enable({apis:["Date"],now:Date.parse("2026-11-12T10:00:00Z")});
  const pick = { candidateId: 1, ticker: "NIBE-B.ST", source: "edgeai", market: "SE", direction: "LONG",
    category: "MOMENTUM", rank: 1, signalDate: "2026-10-28",
    entryPrice: 43.66, stopPrice: 42.05, targetPrice: 47.7, rr: 2.50931677018634,
    decision: { status: "TRADEABLE" } };
  const signal = { id: 1, ...pick, dataQuality: qualifiedEdgeQuality, signalSource: "edgeai", edgeWinRate: 0.6, edgeExpectancyR: 0.4, edgeSampleN: 80 };
  const before = JSON.stringify({ pick, signal });
  const html = renderToStaticMarkup(React.createElement(ResearchCard, { pick, signal, dataDate: "2026-10-27",stale:true }));
  const visible = visibleWhenClosed(html);
  assert.ok(html.indexOf('aria-label="Entry ') < html.indexOf("Momentum-setup"));
  for (const field of ["43,66", "42,05", "47,70", "2,51", "HISTORISKT – ingen ny entry", "Aktuell kurs · ej hämtad", "As-of: okänd"]) {
    assert.ok(visible.includes(field), field);
  }
  assert.ok(!visible.includes("Träff hist."));
  assert.ok(html.includes("Träff hist."));
  assert.ok(!html.includes("2.50931677018634"));
  assert.equal(JSON.stringify({ pick, signal }), before);
});

test("source mismatch and missing status remain visible with timestamp details closed", () => {
  const row: SessionSourceReport = {
    source: "telegram", status: "SUCCESS", fingerprint: "v2:test", signalDate: "2026-10-28",
    reportDate: "2026-10-28", generatedAt: null, importedAt: "2026-10-29T08:00:00Z",
    dataDates: { SE: "2026-10-28", US: null },
  };
  const html = renderToStaticMarkup(React.createElement(SourceProvenance, { reports: [
    row, { ...row, source: "edgeai", dataDates: { SE: "2026-10-27", US: null } },
  ] }));
  assert.ok(visibleWhenClosed(html).includes("inte datumssynkroniserade"));
  assert.ok(visibleWhenClosed(html).includes("data 2026-10-28"));
  assert.ok(visibleWhenClosed(html).includes("data 2026-10-27"));
  assert.ok(html.includes("Importerad 2026-10-29 09:00"));
  const missing = visibleWhenClosed(renderToStaticMarkup(React.createElement(SourceProvenance, { reports: [] })));
  assert.ok(missing.includes("Importkvittens saknas"));
  assert.ok(missing.includes("Synkronisering ej verifierad"));
});
