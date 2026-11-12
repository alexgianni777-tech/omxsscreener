import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {cashResearch,type CashEvidence} from "./cashResearch";
import {cashTestEvidence,CASH_TEST_NOW as now} from "./cashResearch.testFixtures";
import {CashResearch,CashResearchRanking,cashResearchRanking} from "../components/CashResearch";
const assess=(e:CashEvidence)=>cashResearch(e,now,{ticker:e.ticker,market:e.market});

test("synthetic source-bound cash and TTM inputs calculate strong/weak research, never trade qualification",()=>{
  for(const weak of [false,true]){
    const e=cashTestEvidence(weak),copy=structuredClone(e),r=assess(e);
    assert.equal(r.status,"RESEARCH");assert.equal(r.classification,weak?"CASH WEAK":"CASH STRONG");
    assert.equal(r.netCash,weak?-249:70);assert.equal(r.fcf,weak?-5:10);assert.equal(r.previousFcf,8);
    assert.equal(r.demo,true);assert.deepEqual(e,copy);
  }
});
test("missing debt/investments, nonfinite amounts or unclear leasing never become zero-filled net cash",()=>{
  for(const patch of [{interestBearingDebt:undefined},{shortTermInvestments:undefined},{cash:NaN},
    {cash:Infinity},{interestBearingDebt:-1},{leaseLiabilities:-1},{debtDefinition:"UNKNOWN"},
    {debtDefinition:"EXCLUDING_LEASES",leaseLiabilities:undefined}]){
    const e=cashTestEvidence();Object.assign(e.balance!,patch);
    assert.equal(assess(e).status,"DATA_MISSING");assert.equal(assess(e).netCash,null);
  }
  const e=cashTestEvidence();Object.assign(e.balance!,{debtDefinition:"EXCLUDING_LEASES",leaseLiabilities:10});
  assert.equal(assess(e).netCash,60);
  Object.assign(e.balance!,{debtDefinition:"INCLUDING_LEASES"});
  assert.equal(assess(e).netCash,70,"no double-counting included leases");
});
test("mixed currency, scope, reporting entity, periods or incomplete capex cannot yield comparable FCF",()=>{
  for(const patch of [{currency:"USD"},{scope:"PARENT_ONLY"},{entityId:"OTHER"},{start:"2026-07-01"},
    {end:"2026-06-30"},{method:"UNDECLARED"},{capex:undefined},{capex:-2}]){
    const e=cashTestEvidence();Object.assign(e.current!,patch);assert.equal(assess(e).status,"DATA_MISSING");
  }
  const e=cashTestEvidence();e.previous!.currency="USD";
  assert.equal(assess(e).fcf,null);
});
test("manual claims, later publication/observations and unzoned timestamps cannot retrofit historical signals",()=>{
  const e=cashTestEvidence();
  for(const patch of [{kind:"MANUAL_UNVERIFIED"},{verification:"UNVERIFIED"},{documentId:""},
    {publishedAt:"2026-11-13T08:00:00Z"},{publishedAt:"2026-10-20T08:00:00"}]){
    const bad=structuredClone(e);Object.assign(bad.balance!.source,patch);
    assert.equal(assess(bad).status,"DATA_MISSING");
  }
  assert.equal(cashResearch(e,now,{ticker:e.ticker,market:e.market,historical:true}).status,"DATA_MISSING");
  assert.equal(cashResearch(e,now,{ticker:e.ticker,market:e.market,signalAt:"2026-11-10T10:00:00Z"}).status,"DATA_MISSING");
  assert.equal(cashResearch(e,now,{ticker:"OTHER",market:e.market}).status,"DATA_MISSING");
  assert.equal(cashResearch({edgeExpectancyR:0.5} as any,now).status,"DATA_MISSING");
});
test("valuation thresholds, financial period age, verified report date and completed stock trend are explicit gates",()=>{
  for(const change of [
    (e:CashEvidence)=>{e.policy=undefined;},
    (e:CashEvidence)=>{e.policy!.maxStatementAgeDays=1;},
    (e:CashEvidence)=>{e.valuation!.multiple=Infinity;},
    (e:CashEvidence)=>{e.valuation!.currency="USD";},
    (e:CashEvidence)=>{e.valuation!.period="2026-06-30";},
    (e:CashEvidence)=>{e.valuation!.priceDataAsOf="2026-11-10";},
    (e:CashEvidence)=>{e.priceTrend!.source.publishedAt="2026-11-11T10:00:00Z";},
    (e:CashEvidence)=>{e.priceTrend!.instrumentType="MINI_FUTURE" as any;},
    (e:CashEvidence)=>{e.report=undefined;},
    (e:CashEvidence)=>{e.report!.date="2026-11-13";},
  ]){
    const e=cashTestEvidence();change(e);const r=assess(e);assert.equal(r.status,"WATCH");assert.equal(r.classification,null);
  }
});
test("weak cash needs declining negative FCF, measurable debt/EBITDA and deteriorating coverage; negative earnings bases remain unknown",()=>{
  for(const change of [
    (e:CashEvidence)=>{e.current!.ebitda=0;},
    (e:CashEvidence)=>{e.current!.interestExpense=0;},
    (e:CashEvidence)=>{e.current!.ebit=20;},
    (e:CashEvidence)=>{e.current!.operatingCashFlow=30;},
    (e:CashEvidence)=>{e.previous!.netIncome=-10;},
  ]){
    const e=cashTestEvidence(true);change(e);assert.equal(assess(e).classification,null);assert.equal(assess(e).status,"WATCH");
  }
});
test("USA keeps its own identity, completed close and calendar, not Swedish intraday timing",()=>{
  const e=cashTestEvidence();e.market="US";e.ticker="DEMO";
  e.priceTrend!.ticker=e.ticker;e.priceTrend!.market="US";
  assert.equal(assess(e).status,"WATCH","16:30 UTC is not the US close");
  e.priceTrend!.source.publishedAt="2026-11-11T21:00:00Z";
  assert.equal(assess(e).classification,"CASH STRONG");
});
test("raw partial inputs, provenance and test labeling are visible; real empty inputs remain DATA_MISSING without network activity",()=>{
  const e=cashTestEvidence();e.balance!.interestBearingDebt=undefined as any;
  const html=renderToStaticMarkup(React.createElement(CashResearch,{ticker:e.ticker,market:e.market,evidence:e,now}));
  for(const word of ["DATA_MISSING","DEMO / TESTDATA","DEMO-FILING-CURRENT","2026-09-30","SEK","Capex","ej verifierat"])
    assert.ok(html.includes(word),word);
  const rows=[{ticker:"REAL",market:"US"},{ticker:e.ticker,market:e.market,evidence:cashTestEvidence()}];
  assert.equal(cashResearchRanking(rows,now)[0].result.classification,"CASH STRONG");
  const empty=renderToStaticMarkup(React.createElement(CashResearchRanking,{entries:[rows[0]],now}));
  assert.ok(empty.includes("CASH STRONG · 0"));assert.ok(empty.includes("CASH WEAK · 0"));
  assert.ok(empty.includes("DATA_MISSING"));assert.ok(empty.includes("Ingen verifierad fundamentalskälla"));
});
