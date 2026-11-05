import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchCard } from "./ResearchCard";
import { SourceProvenance } from "./SourceProvenance";
import { pickWarnings } from "./SwedishResearch";
import { qualifiedEdgeQuality } from "../lib/sourceQuality.fixtures";

const pick = { candidateId: 1, ticker: "EVO", market: "SE", direction: "LONG", category: "MOMENTUM",
  source: "edgeai", signalDate: "2026-11-03", rank: 1, entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2,
  decision: { status: "TRADEABLE" } };
const raw = "SE ELUX-B SHORT/WEAKEST isolerad: motstridiga planer";
const receipt: any = { source: "edgeai", status: "SUCCESS", signalDate: pick.signalDate,
  reportDate: pick.signalDate, fingerprint: "DEMO", importedAt: "2026-11-03T10:00:00Z",
  dataDates: { SE: "2026-11-02", US: "2026-11-02" }, warnings: [raw, raw],
  quarantinedIdentities: ["SE|WEAKEST|ELUX-B|SHORT|2026-11-03|edgeai"] };
const signal = { id: 1, dataQuality: qualifiedEdgeQuality, earningsKnowledge: "SIGNAL_TIME" as const, earningsInDays: 20,
  entryPrice: 100, stopPrice: 95, targetPrice: 110 };
const quote: any = { ticker: "EVO", yahooTicker: "EVO.ST", livePrice: 100, marketState: "REGULAR",
  asOf: new Date().toISOString() };
const card = (props: any = {}) => renderToStaticMarkup(React.createElement(ResearchCard, {
  pick, signal, dataDate: "2026-11-02", quote, ...props,
}));

test("global raw diagnostics occur once in source disclosure, never on unrelated EVO card", () => {
  const warnings = pickWarnings(pick, [receipt], []);
  assert.ok(!warnings.some(w => w.includes("ELUX")));
  const html = card({ warnings });
  assert.ok(!html.includes(raw));
  assert.ok(html.includes("AVVAKTA – entry ej bekräftad"));
  assert.ok(html.includes("ej fullständigt verifierad omfattning"));
  const source = renderToStaticMarkup(React.createElement(SourceProvenance, { reports: [receipt] }));
  assert.equal((source.match(/SE ELUX-B SHORT\/WEAKEST/g) ?? []).length, 1);
  assert.ok(source.includes("1 datavarning(ar)") && source.includes("<details"));
});

test("only exact structured quarantine identity marks the affected card, with no repeated conflict", () => {
  const affected = { ...pick, ticker: "ELUX B", direction: "SHORT", category: "WEAKEST",
    stopPrice: 105, targetPrice: 90 };
  const warnings = pickWarnings(affected, [receipt], []);
  assert.ok(warnings.includes("Källkonflikt – ingen entrybekräftelse"));
  const html = card({ pick: affected, warnings });
  assert.ok(html.includes("BLOCKERAD – ingen ny entry"));
  assert.equal((html.match(/Källkonflikt – ingen entrybekräftelse/g) ?? []).length, 1);
  for (const other of [{ ...affected, market: "US" }, { ...affected, signalDate: "2026-11-02" },
    { ...affected, source: "telegram" }, { ...affected, category: "MOMENTUM" }]) {
    assert.ok(!pickWarnings(other, [receipt], []).some(w => w.startsWith("Källkonflikt")));
  }
});

test("same-identity plans conflict, other setup periods and sources do not; missing identity stays uncertain", () => {
  const alternative: any = { ...pick, id: 2, signalSource: "edgeai", stopPrice: 94 };
  assert.ok(pickWarnings(pick, [], [alternative]).some(w => w.startsWith("Flera planer/")));
  for (const other of [{ ...alternative, signalDate: "2026-11-02" }, { ...alternative, market: "US" },
    { ...alternative, category: "STUDS" }, { ...alternative, signalSource: "telegram" }]) {
    assert.equal(pickWarnings(pick, [], [other]).length, 0);
  }
  assert.ok(pickWarnings(pick, [], [{ ...alternative, signalSource: undefined }])[0].includes("osäker"));
});

test("READY requires all existing conditions; missing evidence awaits; stale and passed plans block", () => {
  assert.ok(card().includes("READY – entryvillkor verifierade, inte en order"));
  for (const props of [{ quote: undefined }, { quote: { ...quote, asOf: null } }, { signal: undefined },
    { dataDate: null }, { warnings: ["Källans omfattning är osäker"] }]) {
    const html = card(props);
    assert.ok(html.includes("AVVAKTA – entry ej bekräftad"));
    assert.ok(!html.includes("READY – entryvillkor verifierade"));
  }
  for (const props of [{ stale: true }, { quote: { ...quote, livePrice: 111 } },
    { quote: { ...quote, livePrice: 94 } }, { quote: { ...quote, livePrice: 102 } }]) {
    assert.ok(card(props).includes("BLOCKERAD – ingen ny entry"));
  }
  const original = JSON.stringify({ pick, signal, receipt });
  card({ warnings: pickWarnings(pick, [receipt], []) });
  assert.equal(JSON.stringify({ pick, signal, receipt }), original);
});
