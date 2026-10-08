import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundZeroResult, manualSek } from "./GroundZero";
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
