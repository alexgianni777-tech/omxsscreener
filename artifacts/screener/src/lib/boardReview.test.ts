import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {BoardReview} from "../components/BoardReview";
import {boardArchive} from "@workspace/market-calendar/research-policy";
test("board protocol is collapsible and leaves all five human perspectives empty, with no auto approval",()=>{
  const html=renderToStaticMarkup(React.createElement(BoardReview,{context:"DEMO SCA-B LONG entry 100 stop 95 target 110"}));
  assert.ok(html.includes("<details"));assert.ok(!html.includes("<details open"));
  for(const name of ["Atlas","Eleanor","Victor","Harper","Eric"])assert.ok(html.includes(name));
  assert.equal((html.match(/<textarea/g)??[]).length,5);
  assert.ok(html.includes("BOARD REVIEW REQUIRED"));
  assert.ok(html.includes("Riskunderlag saknas – ej godkänt."));
  assert.ok(html.includes("inte AI-signaturer"));
  assert.ok(html.includes("sm:grid-cols-3"));
});
test("manual archive preserves original plan and never claims that documentation verifies risk/costs",()=>{
  const text=boardArchive("DEMO entry=100 stop=95 target=110","Manual chat",Array(5).fill("Human opinion"),"2026-11-12");
  assert.ok(text.includes("entry=100 stop=95 target=110"));
  assert.ok(text.includes("inte verifierat ordergodkännande"));
  assert.ok(text.includes("Ingen automatisk entry eller order"));
  assert.throws(()=>boardArchive("Cookie: DEMO_TEST_ONLY","",[],"2026-11-12"));
});
