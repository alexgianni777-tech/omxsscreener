import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyCandidates } from "../components/DailyCandidates";
import { swedishDailyPicks, oldSignalWarning, type DailyPick } from "./dailyCandidates";

const pick = (id: number, direction = "LONG", market = "SE"): DailyPick => ({
  candidateId: id, ticker: `TEST${id}`, rank: id, market, direction, source: "edgeai",
  signalDate: "2026-10-09", category: "MOMENTUM", entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2,
});
test("compact suggestions keep existing order, deduplicate symbols and cap each SE side without changing USA or originals", () => {
  const rows = [pick(9), pick(2), pick(3), pick(4), pick(5), pick(6, "SHORT"), pick(7, "SHORT"), pick(8, "SHORT"), pick(10, "SHORT"), pick(1, "LONG", "US")];
  const before = JSON.stringify(rows);
  const groups = swedishDailyPicks(rows);
  assert.deepEqual(groups[0].picks.map(p => p.candidateId), [2, 3, 4]);
  assert.equal(groups[1].picks.length, 3);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(rows.filter(p => p.market === "US").length, 1);
  assert.equal(swedishDailyPicks([pick(1), { ...pick(2), ticker: "test1.ST" }])[0].picks.length, 1);
});
test("Friday close stays eligible on Monday; older, future and unknown dates are warned", () => {
  assert.equal(oldSignalWarning("2026-10-09", "2026-10-12"), null);
  assert.ok(oldSignalWarning("2026-10-08", "2026-10-12"));
  assert.ok(oldSignalWarning("2026-10-13", "2026-10-12"));
  assert.ok(oldSignalWarning(null, "2026-10-12"));
});
test("view states manual Avanza/ChatGPT workflow, original plans, unknown data, conflicts and no invented signals", () => {
  const p = pick(1);
  const html = renderToStaticMarkup(createElement(DailyCandidates, {
    picks: [p], signals: [{ id: 2, ticker: p.ticker, market: "SE", direction: "SHORT", entryPrice: 105, stopPrice: 110, targetPrice: 95 }],
    sessionDate: "2026-10-12", preliminary: true, now: new Date("2026-10-12T08:00:00Z"),
  }));
  for (const text of ["Avanza", "ChatGPT", "Ingen position eller order", "Original entry", "Datadag okänd", "Flera planer", "Källhälsa", "Preliminärt", "Inga extra signaler", "helgdagskalender"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("<form"));
});
test("a report generated today can validly use yesterday's close; competing versions never lend a newer date to an older plan", () => {
  const p = { ...pick(1), signalDate: "2026-10-12" };
  const report = { source: "edgeai", signalDate: p.signalDate, reportDate: "2026-10-12", generatedAt: "2026-10-12T08:00:00Z",
    importedAt: "2026-10-12T08:05:00Z", fingerprint: "v1:first", dataDates: { SE: "2026-10-09", US: null } };
  const props = { picks: [p], signals: [], sessionDate: "2026-10-12", now: new Date("2026-10-12T08:00:00Z") };
  const html = renderToStaticMarkup(createElement(DailyCandidates, { ...props, reports: [report] }));
  assert.ok(html.includes("Datadag 2026-10-09"));
  assert.ok(!html.includes("Datadag är inte föregående vardag"));
  const multiple = renderToStaticMarkup(createElement(DailyCandidates, { ...props, reports: [report, { ...report, fingerprint: "v1:second", dataDates: { SE: "2026-10-08", US: null } }] }));
  assert.ok(multiple.includes("Datadag okänd"));
  assert.ok(multiple.includes("Flera rapportversioner"));
});
test("rejected source reports show an error but never provide a successful price date or import status", () => {
  const p = pick(1);
  const report = { source: "edgeai", signalDate: p.signalDate!, reportDate: "2026-10-12", generatedAt: null,
    importedAt: "2026-10-12T08:00:00Z", fingerprint: "v1:bad", status: "FAILED" as const,
    error: "Motstridiga stopnivåer", dataDates: { SE: "2026-10-09", US: null } };
  const html = renderToStaticMarkup(createElement(DailyCandidates, {
    picks: [p], signals: [], reports: [report], sessionDate: "2026-10-12", now: new Date("2026-10-12T08:00:00Z"),
  }));
  assert.ok(html.includes("Import avvisad"));
  assert.ok(html.includes("Motstridiga stopnivåer"));
  assert.ok(html.includes("Datadag okänd"));
  assert.ok(!html.includes("senaste kvitterade import"));
});
