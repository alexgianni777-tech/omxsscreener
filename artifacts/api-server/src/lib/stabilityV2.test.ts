import test from "node:test";
import assert from "node:assert/strict";
import { reviewCandidate, decideCandidate, AUTOMATIC_EARNINGS_CHECK_ENABLED } from "./screeningReview";
import { observedReportDate, reportWindow, marketDate } from "@workspace/market-calendar";
const now=new Date("2026-11-12T10:00:00Z");
const base={ticker:"SCA-B",market:"SE",signalSource:"telegram",signalDate:"2026-11-12",
  category:"MOMENTUM",direction:"LONG",rs3m:2,perf1m:2,rsi:50,atr:1,signalRsi:50,signalGapPct:0,
  volMultiplier:1,volumeAsOf:"2026-11-11",earningsInDays:20,earningsKnowledge:"SIGNAL_TIME" as const,
  entryPrice:100,stopPrice:95,targetPrice:110,rr:2,price:100};
test("finite/range validation rejects bad market inputs without changing their audit values",()=>{
  assert.equal(reviewCandidate(base,"telegram",now).status,"WARN"); // No verified index regime in this fixture.
  for(const patch of [{perf1m:NaN},{perf1m:Infinity},{rs3m:-Infinity},{atr:0},{atr:NaN},{atr:-1},
    {volMultiplier:NaN},{volMultiplier:0},{volMultiplier:-2},{rsi:101},{rr:Infinity},{direction:"UNKNOWN"},{volumeAsOf:"2026-02-30"},
    {targetPrice:101,rr:2}]) {
    const input={...base,...patch},before=structuredClone(input);
    const review=reviewCandidate(input,"telegram",now);
    assert.equal(review.status,"BLOCKED",JSON.stringify(patch));
    assert.notEqual(decideCandidate(input,review,base.signalDate,now).status,"TRADEABLE");
    assert.deepEqual(input,before);
  }
});
test("unknown report dates and nearby reports block, not merely warn",()=>{
  assert.equal(AUTOMATIC_EARNINGS_CHECK_ENABLED,false,"strict evidence gate must not activate new provider calls");
  for(const patch of [{earningsKnowledge:"UNKNOWN" as const},{earningsInDays:null},{earningsInDays:0},{earningsInDays:5}]) {
    const input={...base,...patch},review=reviewCandidate(input,"telegram",now);
    assert.equal(review.status,"BLOCKED");
    assert.match(review.reasons.join(" "),/UNKNOWN_REPORT_DATE|REPORT_WITHIN_5_TRADING_DAYS/);
    assert.equal(decideCandidate(input,{status:"APPROVED",reasons:[]},base.signalDate,now).status,"BLOCKED");
  }
});
test("reports use exchange calendar days and five trading days across US/SE holidays",()=>{
  assert.equal(observedReportDate("2026-11-25",9,"SIGNAL_TIME"),"2026-12-04");
  assert.equal(observedReportDate("2026-11-25",NaN,"SIGNAL_TIME"),null);
  assert.equal(reportWindow("2026-12-03","2026-11-25","US").tradingDays,5);
  assert.equal(reportWindow("2026-12-03","2026-11-25","US").blocked,true);
  assert.equal(reportWindow("2026-12-04","2026-11-25","US").blocked,false);
  assert.equal(reportWindow("2026-12-28","2026-12-23","SE").tradingDays,1);
  assert.equal(reportWindow("2026-11-25","2026-11-25","US").tradingDays,0);
  assert.equal(marketDate(new Date("2026-11-25T23:30:00Z"),"US"),"2026-11-25");
  assert.equal(marketDate(new Date("2026-11-25T23:30:00Z"),"SE"),"2026-11-26");
});
test("valid STUDS and WEAKEST remain research without independent net evidence",()=>{
  for(const p of [{category:"STUDS",rsi:30,pctB:-0.01},
    {category:"WEAKEST",direction:"SHORT",rs3m:-2,perf1m:-2,stopPrice:105,targetPrice:90}]) {
    const input={...base,...p},review=reviewCandidate(input,"telegram",now);
    assert.equal(review.status,"WARN");
    assert.match(review.reasons.join(" "),/RESEARCH/);
    assert.equal(decideCandidate(input,review,base.signalDate,now).status,"WAIT");
  }
});
