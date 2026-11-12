import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createEdgeAiSyncRouter } from "./edgeAiSync";
import { validImportBearer } from "../lib/importBearer";

test("shared Telegram/EdgeAI bearer check fails closed without exposing credentials", () => {
  const fake = "unit-test-credential";
  assert.equal(validImportBearer(undefined,fake),false);
  assert.equal(validImportBearer("Basic "+fake,fake),false);
  assert.equal(validImportBearer("Bearer wrong",fake),false);
  assert.equal(validImportBearer("Bearer "+fake,undefined),false);
  assert.equal(validImportBearer("Bearer "+fake,fake),true);
});

test("external sync rejects unauthenticated requests before imports; valid request waits, takes no report override and fails honestly", async () => {
  let runs = 0;
  let configured: string | undefined = "unit-test-credential";
  let fail = false;
  const app = express();
  app.use(express.json());
  app.use("/api",createEdgeAiSyncRouter(async () => {
    runs++;
    return {status:fail ? "FAILED" : "UNCHANGED"};
  },() => configured));
  const server = app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve => server.on("listening",resolve));
  try {
    const addr = server.address() as {port:number};
    const url = `http://127.0.0.1:${addr.port}/api/edgeai-sync`;
    assert.equal((await fetch(url,{method:"POST"})).status,401);
    assert.equal(runs,0);
    assert.equal((await fetch(url,{method:"POST",headers:{Authorization:"Bearer wrong"}})).status,401);
    assert.equal(runs,0);
    const headers = {Authorization:"Bearer "+configured,"Content-Type":"application/json"};
    const ok = await fetch(url,{method:"POST",headers,body:JSON.stringify({date:"1999-01-01",text:"not imported"})});
    assert.equal(ok.status,200);
    assert.deepEqual(await ok.json(),{status:"UNCHANGED"});
    assert.equal(runs,1);
    fail = true;
    assert.equal((await fetch(url,{method:"POST",headers})).status,503);
    configured = undefined;
    const missing = await fetch(url,{method:"POST",headers});
    assert.equal(missing.status,503);
    assert.ok(!(await missing.text()).includes("unit-test-credential"));
    assert.equal(runs,2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve,reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
