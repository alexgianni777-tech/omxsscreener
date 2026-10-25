import assert from "node:assert/strict";
import test from "node:test";
import { calculateWilderRsi } from "./marketIndicators";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { fetchOmxsMarketWeather } from "./omxsMarketWeather";

test("Wilder RSI uses the standard 14-change seed, including 15 and 22 bar snapshots", () => {
  const publishedExample = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  assert.equal(calculateWilderRsi(publishedExample), 70.5);
  assert.equal(calculateWilderRsi(Array(22).fill(100)), 50);
  assert.equal(calculateWilderRsi(Array.from({length:22}, (_, i) => 100+i)), 100);
  assert.equal(calculateWilderRsi(Array.from({length:22}, (_, i) => 100-i)), 0);
});

test("insufficient or invalid closes are missing, never a guessed zero/100 or bridged gaps", () => {
  assert.equal(calculateWilderRsi(Array(14).fill(100)), null);
  for (const bad of [NaN, Infinity, 0, -1]) {
    assert.equal(calculateWilderRsi([...Array(21).fill(100), bad]), null);
  }
  assert.equal(calculateWilderRsi(Array(22).fill(100), 0), null);
});

test("22-bar EdgeAI chart yields genuine signal RSI without rewriting financial plans or legacy placeholders", () => {
  const input = {ticker:"EQT.ST",dir:"short",setup:"short",entry:100,stop:105,target:90,barsAgo:0,
    chart:Array.from({length:22}, (_,i) => ({c:100+i%3-i/20}))};
  const original = JSON.stringify(input);
  const mapped = mapEdgeAiSetup(input,"SE",{});
  assert.ok(mapped.signalRsi != null && mapped.signalRsi > 0 && mapped.signalRsi < 100);
  assert.equal(mapped.direction,"SHORT");
  assert.equal(mapped.entryPrice,100);
  assert.equal(mapped.stopPrice,105);
  assert.equal(mapped.targetPrice,90);
  assert.equal(mapped.rr,2);
  assert.equal(mapped.atr,0);
  assert.equal(mapped.volMultiplier,0);
  assert.equal(mapped.rsi,0); // neutral legacy field, never the signal RSI
  assert.equal(JSON.stringify(input),original);
  assert.equal(mapEdgeAiSetup({...input,barsAgo:8},"SE",{}).signalRsi,null);
});

test("an exact but too-short index history cannot persist false market RSI zero", async () => {
  const yf = {historical: async () => [{date:new Date("2026-10-23T00:00:00Z"),close:100}]};
  await assert.rejects(fetchOmxsMarketWeather(yf,"2026-10-23"), /RSI history insufficient/);
});
