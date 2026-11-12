import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { riskInR, RiskPanel } from "./RiskPanel";
import { ManualCatalysts, MANUAL_CATALYSTS } from "./ManualCatalysts";
test("long/short risk uses the original plan; instruments are not levered underlying P&L; missing net is unknown", () => {
  assert.deepEqual(riskInR({ direction: "LONG", entryPrice: 100, stopPrice: 95, targetPrice: 110 }), { risk: 5, rewardR: 2 });
  const short = { direction: "SHORT", entryPrice: 260.10, stopPrice: 267.54, targetPrice: 245.22 };
  assert.ok(Math.abs(riskInR(short)!.rewardR - 2) < 1e-10);
  assert.equal(riskInR({ ...short, direction: "LONG" }), null);
  const before = JSON.stringify(short);
  const html = renderToStaticMarkup(React.createElement(RiskPanel, { plan: short, instrument: "PRODUCT", netR: -1.1 }));
  for (const s of ["handlat instrument", "7,44", "-1.10R", "garanteras inte", "knock-out"]) assert.ok(html.includes(s));
  const unknown = renderToStaticMarkup(React.createElement(RiskPanel, { plan: short, realizedR: 2 }));
  assert.ok(unknown.includes("kostnader ej verifierade"));
  assert.equal(JSON.stringify(short), before);
});
test("manual catalyst cases have requested dates/times and never claim confirmed dates or buy signals", () => {
  assert.deepEqual(MANUAL_CATALYSTS.map(c => [c.symbol, c.date]), [
    ["SAM", "2026-10-22"], ["BUD", "2026-10-29"], ["TAP", "2026-11-05"], ["C", "2026-10-13"], ["BAC", "2026-10-14"],
  ]);
  const html = renderToStaticMarkup(React.createElement(ManualCatalysts));
  assert.ok(html.includes("inga automatiska köpsignaler"));
  assert.ok(html.includes("inte automatiskt verifierade"));
  assert.ok(html.includes("före USA-öppning"));
});
test("stop loss is not an absolute risk guarantee; known time stops remain separate from unlimited share-short risk",()=>{
  const plan={direction:"SHORT",entryPrice:100,stopPrice:105,targetPrice:90};
  const html=renderToStaticMarkup(React.createElement(RiskPanel,{plan,maxHoldDays:5}));
  for(const text of ["NOT_VERIFIED","obegränsad förlust","5 handelsdagar enligt källan","max 20 %","max 4 %","0,5–1 %"])
    assert.ok(html.includes(text),text);
  const unknown=renderToStaticMarkup(React.createElement(RiskPanel,{plan,maxHoldDays:NaN}));
  assert.ok(unknown.includes("Tidsstopp: ej verifierat"));
});
