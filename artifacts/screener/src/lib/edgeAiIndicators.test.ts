import test from "node:test";
import assert from "node:assert/strict";
import { edgeAiIndicators } from "./edgeAiMetrics";

test("EdgeAI signal RSI and plan risk never come from overloaded legacy RSI/ATR fields", () => {
  const row = {signalRsi:51.2,entryPrice:100,stopPrice:105,volMultiplier:2,volumeAsOf:"2026-10-23",
    rsi:0.38,atr:0};
  const before = JSON.stringify(row);
  assert.deepEqual(edgeAiIndicators(row),{rsi:51.2,oneR:5,volume:2});
  assert.equal(JSON.stringify(row),before);
});
test("missing signal RSI and undated volume remain missing; real RSI zero is not fabricated or suppressed", () => {
  assert.deepEqual(edgeAiIndicators({entryPrice:100,stopPrice:100,volMultiplier:2}),
    {rsi:null,oneR:null,volume:null});
  assert.equal(edgeAiIndicators({signalRsi:0}).rsi,0);
  assert.equal(edgeAiIndicators({signalRsi:101}).rsi,null);
});
