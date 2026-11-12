import test from "node:test";
import assert from "node:assert/strict";
import { marketRegime, qualifyResearch } from "./researchQualification";
import { cashResearch } from "./cashResearch";
import { netRiskReward,riskBudget } from "./riskCostPlan";
import { assessLiveEntry } from "./liveEntryGuard";
const now=new Date("2026-11-12T10:00:00Z");
const evidence={category:"MOMENTUM",direction:"LONG",signalSource:"telegram",market:"SE",signalDate:"2026-11-12",
  dataDate:"2026-11-11",atr:1,rsi:50,perf1m:2,rs3m:2,volMultiplier:1,earningsInDays:20,earningsKnowledge:"SIGNAL_TIME",
  entryPrice:100,stopPrice:95,targetPrice:110};
const bull={state:"BULLISH" as const,source:"TEST FIXTURE ONLY",dataDate:"2026-11-11"};
test("qualification requires genuine finite data, report evidence and matching regime",()=>{
  assert.equal(qualifyResearch(evidence,bull,now).status,"QUALIFIED");
  assert.equal(qualifyResearch(evidence,{...bull,state:"BEARISH"},now).status,"WATCH");
  assert.equal(qualifyResearch(evidence,undefined,now).status,"WATCH");
  for(const patch of [{dataDate:null},{dataDate:"2026-11-10"},{perf1m:NaN},{rs3m:Infinity},
    {volMultiplier:0},{earningsKnowledge:"UNKNOWN"},{earningsInDays:0}])
    assert.equal(qualifyResearch({...evidence,...patch},bull,now).status,"BLOCKED");
  for(const category of ["STUDS","WEAKEST"])
    assert.equal(qualifyResearch({...evidence,category},bull,now).status,"RESEARCH");
  assert.equal(qualifyResearch({...evidence,signalSource:"edgeai"},bull,now).status,"WATCH");
});
test("D-1 survives weekends and market holidays, but a close is not a live quote",()=>{
  const monday=new Date("2026-11-16T10:00:00Z");
  assert.equal(qualifyResearch({...evidence,signalDate:"2026-11-16",dataDate:"2026-11-13"},
    {...bull,dataDate:"2026-11-13"},monday).status,"QUALIFIED");
  const thanksgiving=new Date("2026-11-27T15:00:00Z");
  assert.equal(qualifyResearch({...evidence,market:"US",signalDate:"2026-11-27",dataDate:"2026-11-25"},
    {...bull,dataDate:"2026-11-25"},thanksgiving).status,"QUALIFIED");
  assert.equal(assessLiveEntry({direction:"LONG",entryPrice:100,stopPrice:95,targetPrice:110},
    {livePrice:100,asOf:"2026-11-11T16:30:00Z",marketState:"REGULAR"},now.getTime()).status,"STALE_PRICE");
});
test("index SMA requires one timestamped market/source identity and rejects conflicts",()=>{
  const report:any={status:"SUCCESS",dataDates:{SE:"2026-11-11"},marketContext:{SE:{dataAsOf:"2026-11-11",
    indexSnapshot:{close:110,sma50:105,sma200:100,source:"TEST FIXTURE",asOf:"2026-11-11T16:30:00Z"}}}};
  assert.equal(marketRegime([report],"SE",evidence.dataDate,now).state,"BULLISH");
  assert.equal(marketRegime([report],"US",evidence.dataDate,now).state,"UNKNOWN");
  assert.equal(marketRegime([{...report,dataDates:{SE:"2026-11-10"}}],"SE",evidence.dataDate,now).state,"UNKNOWN");
  const intraday=structuredClone(report);intraday.marketContext.SE.indexSnapshot.asOf="2026-11-11T10:00:00Z";
  assert.equal(marketRegime([intraday],"SE",evidence.dataDate,now).state,"UNKNOWN");
  const bad=structuredClone(report);bad.marketContext.SE.indexSnapshot.sma50=NaN;
  assert.equal(marketRegime([bad],"SE",evidence.dataDate,now).state,"UNKNOWN");
  const other=structuredClone(report);other.marketContext.SE.indexSnapshot.close=90;
  assert.equal(marketRegime([report,other],"SE",evidence.dataDate,now).state,"UNKNOWN");
});
test("cash classifications never fabricate inputs or produce a trading qualification",()=>{
  assert.equal(cashResearch().status,"DATA_MISSING");
  const data:any={cash:100,shortTermInvestments:20,interestBearingDebt:50,fcf:10,previousFcf:8,
    interestCoverage:4,previousCoverage:3,earningsGrowth:1,valuationMultiple:10,trend:"BULLISH",
    currency:"SEK",period:"2026-09-30",previousPeriod:"2025-09-30",source:"TEST FIXTURE ONLY",
    publishedAt:"2026-10-20T08:00:00Z",asOf:"2026-11-11T08:00:00Z",provenanceVerified:true};
  assert.equal(cashResearch(data,now.getTime()).netCash,70);
  assert.equal(cashResearch(data,now.getTime()).classification,"CASH STRONG");
  assert.equal(cashResearch(data,now.getTime()).status,"RESEARCH");
  assert.equal(cashResearch({...data,interestBearingDebt:NaN},now.getTime()).status,"DATA_MISSING");
  assert.equal(cashResearch({...data,provenanceVerified:false},now.getTime()).status,"DATA_MISSING");
  assert.equal(cashResearch({...data,cash:1,shortTermInvestments:0,fcf:-5,previousFcf:2,
    interestCoverage:0.5,previousCoverage:2,earningsGrowth:-1,trend:"BEARISH"},now.getTime()).classification,"CASH WEAK");
});
test("net RR needs complete fresh instrument costs; capital limits never pass unknown FX",()=>{
  assert.equal(netRiskReward(undefined,now.getTime()),null);
  const costs={grossRiskKr:100,grossRewardKr:200,spreadCostKr:2,commissionKr:6,fundingKr:2,
    fx:1,asOf:now.toISOString(),source:"TEST FIXTURE",instrumentId:"TEST",contractTermsVerified:true,marketState:"REGULAR"};
  assert.equal(netRiskReward(costs,now.getTime()),190/110);
  assert.equal(netRiskReward({...costs,fx:NaN},now.getTime()),null);
  assert.equal(netRiskReward({...costs,asOf:"2026-11-11T10:00:00Z"},now.getTime()),null);
  assert.equal(netRiskReward({...costs,contractTermsVerified:false},now.getTime()),null);
  for(const patch of [{source:null},{instrumentId:undefined},{asOf:now.toISOString().slice(0,-1)},
    {spreadCostKr:undefined},{contractTermsVerified:1}]){
    assert.equal(netRiskReward({...costs,...patch} as any,now.getTime()),null);
  }
  assert.equal(riskBudget(10000,2000,400,true),"PASS");
  assert.equal(riskBudget(10000,2001,400,true),"BLOCKED");
  assert.equal(riskBudget(10000,2000,401,true),"BLOCKED");
  assert.equal(riskBudget(10000,2000,400,false),"NOT_VERIFIED");
  assert.equal(riskBudget(null,2000,400,true),"NOT_VERIFIED");
});
