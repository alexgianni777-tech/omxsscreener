import test from "node:test";
import assert from "node:assert/strict";
import {candidateQualification,reviewCandidate,decideCandidate,screenCandidate} from "./screeningReview";
import {qualifyResearch,marketRegime,boardArchive,BOARD_REVIEW_REQUIRED,hasVerifiedAtr} from "@workspace/market-calendar/research-policy";
import {mapEdgeAiSetup} from "./edgeAiMapping";
import {buildTop3SelectionSnapshot} from "./top3SelectionPolicyCore";

const now=new Date("2026-11-12T10:00:00Z");
const base={ticker:"SCA-B",market:"SE",signalSource:"telegram",signalDate:"2026-11-12",category:"MOMENTUM",direction:"LONG",
  rs3m:2,perf1m:2,rsi:50,atr:1,signalRsi:50,signalGapPct:0,volMultiplier:1,volumeAsOf:"2026-11-11",
  earningsInDays:20,earningsKnowledge:"SIGNAL_TIME" as const,entryPrice:100,stopPrice:95,targetPrice:110,rr:2,price:100};
const receipt=(market="SE",state="BULLISH"):any=>({status:"SUCCESS",dataDates:{[market]:"2026-11-11"},
  marketContext:{[market]:{dataAsOf:"2026-11-11",indexSnapshot:{close:state==="BEARISH"?90:110,
    sma50:state==="BEARISH"?95:state==="NEUTRAL"?110:105,sma200:100,source:"DEMO TEST ONLY",
    asOf:market==="SE"?"2026-11-11T16:30:00Z":"2026-11-11T21:00:00Z"}}}});

test("API and UI use the same implementation and statuses for identical SE/US inputs",async()=>{
  const wrapperPath="../../../screener/src/lib/researchQualification.ts";
  const ui=await import(wrapperPath);
  assert.equal(ui.qualifyResearch,qualifyResearch);
  for(const market of ["SE","US"])for(const state of ["BULLISH","BEARISH","NEUTRAL","UNKNOWN"]){
    const e={...base,market,ticker:market==="US"?"MSFT":"SCA-B"};
    const reports=state==="UNKNOWN"?[]:[receipt(market,state)];
    const backend=candidateQualification(e,"telegram",now,{reports});
    const frontend=ui.qualifyResearch(e,marketRegime(reports,market,e.volumeAsOf,now),now);
    assert.deepEqual(frontend,backend);
    const review=reviewCandidate(e,"telegram",now,{reports});
    const capped=ui.qualifyResearch({...e,review},marketRegime(reports,market,e.volumeAsOf,now),now);
    if(review.status!=="APPROVED")assert.notEqual(capped.status,"QUALIFIED");
    assert.notEqual(decideCandidate(e,review,e.signalDate,now,{reports}).status,"TRADEABLE");
  }
});
test("same policy rejects stale/unknown dates, NaN, report gaps and research modules in both consumers",()=>{
  const reports=[receipt()];
  for(const patch of [{dataDate:"2026-11-10"},{dataDate:null},{perf1m:NaN},{earningsKnowledge:"UNKNOWN" as const},{earningsInDays:0},
    {category:"STUDS"},{category:"WEAKEST"}]){
    const e={...base,...patch};
    assert.deepEqual(candidateQualification(e,"telegram",now,{reports}),qualifyResearch(e,marketRegime(reports,"SE",e.dataDate??e.volumeAsOf,now),now));
  }
  const mixed=[receipt(),receipt("SE","BEARISH")];
  assert.equal(candidateQualification(base,"telegram",now,{reports:mixed}).status,"WATCH");
  assert.equal(candidateQualification({...base,category:"STUDS"},"telegram",now,{reports}).status,"RESEARCH");
});
test("board gate does not delete qualified screening selections or rewrite original plans",()=>{
  const reports=[receipt()],review=reviewCandidate(base,"telegram",now,{reports}),before=structuredClone(base);
  assert.equal(review.status,"APPROVED");
  assert.equal(screenCandidate(base,review,base.signalDate,now,{reports}).status,"TRADEABLE");
  const decision=decideCandidate(base,review,base.signalDate,now,{reports});
  assert.equal(decision.status,"WAIT");assert.match(decision.reasons[0],/BOARD REVIEW REQUIRED/);
  const rows=buildTop3SelectionSnapshot([{...base,id:1,rank:1,pctB:0.5,distFrom20dH:0} as any],1,base.signalDate,"telegram",now,reports);
  assert.equal(rows.filter(r=>r.selected).length,1);
  assert.deepEqual(base,before);
});
test("EdgeAI retains only correctly bound underlying ATR evidence, not a bare number/NaN/product ATR",()=>{
  const proof={value:2.5,source:"DEMO VERIFIED DAILY OHLC",ticker:"SCA-B",market:"SE",dataAsOf:"2026-11-11",period:14,instrumentType:"UNDERLYING_EQUITY",
    unit:"PRICE",timeframe:"1d",method:"WILDER"};
  const setup={ticker:"SCA-B",setup:"Momentum",dir:"LONG",entry:100,stop:95,target:110,signalT:"2026-11-12T08:00:00Z",
    barsAgo:0,rs:1,edge:{winRate:55,expectancyR:0.2,sample:100},atr:99,atrEvidence:proof};
  const mapped=mapEdgeAiSetup(setup,"SE",{},"2026-11-11");
  assert.equal(mapped.atr,2.5);assert.deepEqual(mapped.dataQuality.atrEvidence,proof);
  assert.equal(hasVerifiedAtr({...mapped,signalSource:"edgeai"}),true);
  for(const atrEvidence of [undefined,{...proof,value:NaN},{...proof,value:0},{...proof,market:"US"},
    {...proof,ticker:"SSAB-A"},{...proof,dataAsOf:"2026-11-10"},{...proof,instrumentType:"MINI_FUTURE"},{...proof,source:""},
    {...proof,unit:"PERCENT"},{...proof,timeframe:"5m"},{...proof,method:undefined}]){
    const row=mapEdgeAiSetup({...setup,atrEvidence},"SE",{},"2026-11-11");
    assert.equal(row.atr,0);assert.equal(hasVerifiedAtr({...row,signalSource:"edgeai"}),false);
  }
});
test("verified EdgeAI ATR removes only its own warning; missing evidence remains WATCH",()=>{
  const atrEvidence={value:2.5,source:"DEMO DAILY OHLC",ticker:"SCA-B",market:"SE",dataAsOf:"2026-11-11",period:14,
    instrumentType:"UNDERLYING_EQUITY",unit:"PRICE",timeframe:"1d",method:"WILDER"};
  const e={...base,signalSource:"edgeai",atr:2.5,edgeExpectancyR:0.2,
    dataQuality:{dataAsOf:"2026-11-11",atrEvidence,entryEligible:true,eliteQualified:true,validatedEdge:true,
      evidenceStatus:"VALIDATED",eliteStatus:"QUALIFIED"}};
  const context={reports:[receipt()]};
  assert.equal(reviewCandidate(e,"edgeai",now,context).status,"APPROVED");
  assert.equal(candidateQualification(e,"edgeai",now,context).status,"QUALIFIED");
  for(const patch of [{atr:NaN},{atr:0},{atr:3},{dataQuality:{...e.dataQuality,atrEvidence:null}}]){
    const review=reviewCandidate({...e,...patch},"edgeai",now,context);
    assert.notEqual(review.status,"APPROVED");
    assert.match(review.reasons.join(" "),/ATR/);
  }
  const research=reviewCandidate({...e,dataQuality:{...e.dataQuality,evidenceStatus:"WATCH"}},"edgeai",now,context);
  assert.notEqual(research.status,"APPROVED");
});
test("manual protocol exports drafts/five perspectives, never AI approval; credential formats are refused",()=>{
  const draft=boardArchive("DEMO SCA-B","",[],"2026-11-12");
  assert.match(draft,/UTKAST/);assert.match(draft,/BOARD REVIEW REQUIRED/);
  const full=boardArchive("DEMO underlying stock","Manual chat 2026-11-12",Array(5).fill("Human review note"),"2026-11-12");
  for(const name of ["Atlas","Eleanor","Victor","Harper","Eric"])assert.ok(full.includes(name));
  assert.match(full,/inte verifierat ordergodkännande/);assert.match(full,/Inga AI-signaturer/);
  assert.throws(()=>boardArchive("DEMO","",["password=DEMO_NOT_A_REAL_SECRET"],"2026-11-12"),/autentiseringsuppgifter/);
  assert.ok(full.startsWith(BOARD_REVIEW_REQUIRED));
});
