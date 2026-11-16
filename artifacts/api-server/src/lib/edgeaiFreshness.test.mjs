import test from "node:test";
import assert from "node:assert/strict";
import { expectedCompletedSession, assessEdgeMarket, isExchangeSession, isValidPublicationTime } from "./edgeaiFreshness.ts";
const at = s => new Date(s);
test("Monday morning imports Friday data as current for both markets", () => {
  const now=at("2026-11-16T09:00:00Z");
  assert.equal(expectedCompletedSession("SE",now),"2026-11-13");
  assert.equal(expectedCompletedSession("US",now),"2026-11-13");
  for(const key of ["SE","US"]){
    assert.equal(assessEdgeMarket(key,{dataAsOf:"2026-11-13",dataStatus:"CURRENT",indexSnapshot:{asOf:"2026-11-13"}},now).fresh,true);
  }
});
test("Monday post-close expectations differ by exchange", () => {
  const now=at("2026-11-16T19:30:00Z");
  assert.equal(expectedCompletedSession("SE",now),"2026-11-16");
  assert.equal(expectedCompletedSession("US",now),"2026-11-13");
});
test("After US publication cutoff Monday requires Monday market close", () => {
  assert.equal(expectedCompletedSession("US",at("2026-11-16T23:00:00Z")),"2026-11-16");
});
test("US Thanksgiving and Swedish midsummer are exchange closures", () => {
  assert.equal(isExchangeSession("US","2026-11-26"),false);
  assert.equal(expectedCompletedSession("US",at("2026-11-27T14:00:00Z")),"2026-11-25");
  assert.equal(isExchangeSession("SE","2026-06-19"),false);
  assert.equal(expectedCompletedSession("SE",at("2026-06-22T07:00:00Z")),"2026-06-18");
});
test("US observed July 4 and Swedish Christmas closures", () => {
  assert.equal(isExchangeSession("US","2026-07-03"),false);
  assert.equal(isExchangeSession("SE","2026-12-24"),false);
  assert.equal(isExchangeSession("SE","2026-12-25"),false);
  assert.equal(isExchangeSession("SE","2026-12-31"),false);
});
test("stale or mismatched index date never passes, force does not change status", () => {
  const now=at("2026-11-16T09:00:00Z");
  const m={dataAsOf:"2026-11-13",dataStatus:"CURRENT",indexSnapshot:{asOf:"2026-11-12"}};
  assert.equal(assessEdgeMarket("SE",m,now).fresh,false);
  assert.equal(assessEdgeMarket("US",{...m,indexSnapshot:{asOf:"2026-11-13"},dataStatus:"STALE"},now).fresh,false);
  assert.equal(assessEdgeMarket("SE",{...m,indexSnapshot:{asOf:"2026-11-13"},dataStatus:"CURRENT_CACHED"},now).cache,true);
});
test("generation date can be Saturday without staleness; future timestamps rejected",()=>{
  assert.equal(isValidPublicationTime("2026-11-14T03:35:14Z",at("2026-11-16T09:00:00Z")),true);
  assert.equal(isValidPublicationTime("2026-11-17T03:35:14Z",at("2026-11-16T09:00:00Z")),false);
});
