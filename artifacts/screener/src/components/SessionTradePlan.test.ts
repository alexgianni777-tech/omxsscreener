import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SessionTradePlan } from "./SessionTradePlan";

test("session plans use available card width instead of squeezed desktop flex columns", () => {
  const plan = Object.freeze({ entryPrice: 118.2, stopPrice: 115.56, targetPrice: 122.59, rr: 1.66287878787878 });
  const html = renderToStaticMarkup(React.createElement(SessionTradePlan, {
    plan, entryGapPct: null, stopPct: 2.2, targetPct: 3.7,
  }));
  for (const value of ["118,20", "115,56", "122,59", "1,66R", "Entry", "Stop", "Mål / TP"]) assert.ok(html.includes(value));
  assert.ok(html.includes("repeat(auto-fit, minmax(min(100%, 7rem), 1fr))"));
  assert.ok(html.includes("col-span-full"));
  assert.ok(!html.includes("1.66287878787878"));
  const page = readFileSync(new URL("../pages/session-detail.tsx", import.meta.url), "utf8");
  assert.ok(!page.includes("2xl:flex-row"));
  assert.ok(!page.includes("2xl:min-w-[280px]"));
  assert.ok(page.includes("<SessionTradePlan plan={candidate}"));
  assert.equal(plan.rr, 1.66287878787878);
});
