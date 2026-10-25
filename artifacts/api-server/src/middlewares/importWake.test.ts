import test from "node:test";
import assert from "node:assert/strict";
import { createImportWakeMiddleware } from "./importWake";

test("owner list read holds the request open until recovery completes; history/quotes/POST do not trigger it", async () => {
  let runs = 0;
  let done = false;
  let finish!: () => void;
  const mw = createImportWakeMiddleware(() => {
    runs++;
    return new Promise<void>(resolve => { finish = resolve; });
  });
  const pending = mw({method:"GET",path:"/screener/top3/last-valid"} as any,{} as any,() => {done=true;});
  assert.equal(runs,1);
  assert.equal(done,false);
  finish();
  await pending;
  assert.equal(done,true);
  for (const [method,path] of [["GET","/screener/sessions/12"],["GET","/screener/quotes"],["POST","/screener/sessions"]]) {
    let continued = false;
    await mw({method,path} as any,{} as any,() => {continued=true;});
    assert.equal(continued,true);
  }
  assert.equal(runs,1);
});

test("a failed wake check does not hide the retained list or expose errors", async () => {
  let continued = false;
  const mw = createImportWakeMiddleware(async () => {throw new Error("upstream down");});
  await mw({method:"GET",path:"/screener/sessions"} as any,{} as any,() => {continued=true;});
  assert.equal(continued,true);
});
