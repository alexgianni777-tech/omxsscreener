import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundZeroResult, GroundZeroHistory, manualSek } from "./GroundZero";
import type { GroundZeroState } from "@workspace/api-client-react";
const base: GroundZeroState = { label: "AG Invest Ground Zero Day", baseDate: "2026-10-08", baselineSek: 16742,
  observedStartSek: 16736.60, reconciliationDifferenceSek: 5.40, goalSek: 100000, targetDate: "2026-12-31", latest: null, history: [] };
test("optional row shows exact benchmark/deadline but never guesses a current balance or return", () => {
  assert.equal(manualSek("16 736,60"), 16736.60);
  assert.equal(manualSek("-1 000,00"), -1000);
  const html = renderToStaticMarkup(React.createElement(GroundZeroResult, { data: base })).replace(/&#x27;/g, "'");
  assert.ok(html.includes("AG Invest Ground Zero Day"));
  assert.ok(html.includes("2026-12-31"));
  assert.ok(html.includes("ej inmatat"));
  assert.ok(html.includes("okänd"));
  assert.ok(!html.includes("16 736"));
});
test("manual reconciliation displays actual date and unknown flows without inventing performance", () => {
  const latest = { id: 1, asOfDate: "2026-10-08", createdAt: "2026-10-08T10:00:00Z", totalValueSek: 16736.60,
    netExternalFlowsSek: null, rawChangeSek: -5.4, adjustedChangeSek: null, adjustedChangePct: null, remainingToGoalSek: 83263.4 };
  const html = renderToStaticMarkup(React.createElement(GroundZeroResult, { data: { ...base, latest, history: [latest] } }));
  assert.ok(html.includes("2026-10-08"));
  assert.ok(html.includes("okänd"));
  assert.ok(!html.includes("−5,40") && !html.includes("-5,40"));
});
const row = { id: 2, asOfDate: "2026-10-12", createdAt: "2026-10-12T10:00:00Z", totalValueSek: 1751,
  netExternalFlowsSek: null, rawChangeSek: -14991, adjustedChangeSek: null, adjustedChangePct: null, remainingToGoalSek: 98249 };
test("history offers row-specific deletion and requires explicit confirmation", () => {
  const props = { history: [row], confirming: null, busy: false, onRequest() {}, onCancel() {}, onConfirm() {} };
  const html = renderToStaticMarkup(React.createElement(GroundZeroHistory, props));
  assert.ok(html.includes("Radera avstämning 2026-10-12"));
  assert.ok(!html.includes("Ja, radera avstämningen"));
  const confirm = renderToStaticMarkup(React.createElement(GroundZeroHistory, { ...props, confirming: 2 }));
  assert.ok(confirm.includes("1 751,00"));
  assert.ok(confirm.includes("Avbryt"));
  assert.ok(confirm.includes("Ja, radera avstämningen"));
  assert.ok(confirm.includes("permanent"));
  assert.ok(confirm.includes("trades och journal påverkas inte"));
});
test("pending deletion disables both confirmation and row actions", () => {
  const html = renderToStaticMarkup(React.createElement(GroundZeroHistory, {
    history: [row], confirming: 2, busy: true, onRequest() {}, onCancel() {}, onConfirm() {},
  }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  assert.ok(html.includes("Raderar…"));
});
