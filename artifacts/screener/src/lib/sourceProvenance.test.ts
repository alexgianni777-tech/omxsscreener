import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionSourceReport } from "@workspace/api-client-react";
import { SourceProvenance } from "../components/SourceProvenance";

const receipt = (source: string, overrides: Partial<SessionSourceReport> = {}): SessionSourceReport => ({
  source, status: "SUCCESS", fingerprint: "v2:example", signalDate: "2026-10-12", reportDate: "2026-10-12",
  generatedAt: "2026-10-12T07:00:00Z", importedAt: "2026-10-12T08:05:00Z",
  dataDates: { SE: "2026-10-09", US: null }, ...overrides,
});
const render = (reports: SessionSourceReport[]) => renderToStaticMarkup(React.createElement(SourceProvenance, { reports }));

test("compact source lines show separate report/data/import times and do not equate aligned dates with identical signals", () => {
  const reports = [receipt("telegram"), receipt("edgeai")];
  const before = JSON.stringify(reports);
  const html = render(reports);
  for (const text of ["Telegram: Importerad", "GitHub/EdgeAI: Importerad", "Rapportdatum 2026-10-12",
    "Marknadsdag SE 2026-10-09 / USA okänd", "Senast lyckad import i sessionen 2026-10-12 10:05", "överensstämmer", "olika signaler", "vald session"]) {
    assert.ok(html.includes(text), text);
  }
  assert.equal(JSON.stringify(reports), before);
});
test("different dates warn without modifying plans or claiming delivery failure", () => {
  const html = render([receipt("telegram"), receipt("edgeai", {dataDates:{SE:"2026-10-08",US:null}})]);
  assert.ok(html.includes("inte datumssynkroniserade"));
  assert.ok(!html.includes("Import avvisad"));
});
test("missing market date or receipt never borrows the report date or claims synchronization", () => {
  const html = render([receipt("telegram", {dataDates:{SE:null,US:null},importedAt:"not-a-time"})]);
  assert.ok(html.includes("Marknadsdag SE okänd / USA okänd"));
  assert.ok(html.includes("Importerad okänd"));
  assert.ok(html.includes("GitHub/EdgeAI: Importkvittens saknas"));
  assert.ok(html.includes("Synkronisering ej verifierad"));
  assert.ok(!html.includes("Invalid Date"));
});
test("latest failure remains visible beside retained successful receipt, not falsely healthy", () => {
  const html = render([receipt("telegram"), receipt("edgeai"), receipt("edgeai", {
    status:"FAILED",reportDate:"2026-10-13",importedAt:"2026-10-13T08:00:00Z", dataDates:{SE:"2026-10-12",US:null},
  })]);
  assert.ok(html.includes("GitHub/EdgeAI: Import avvisad"));
  assert.ok(html.includes("Senast lyckad import i sessionen: Rapportdatum 2026-10-12"));
  assert.ok(html.includes("Avvisat försök 2026-10-13 10:00"));
  assert.ok(html.includes("Synkronisering ej verifierad"));
});
test("legacy status and a date-only import time remain unverified", () => {
  const html = render([receipt("telegram", {status:undefined,importedAt:"2026-10-12"}), receipt("edgeai")]);
  assert.ok(html.includes("status ej verifierad"));
  assert.ok(html.includes("Importerad okänd"));
  assert.ok(html.includes("Synkronisering ej verifierad"));
});
