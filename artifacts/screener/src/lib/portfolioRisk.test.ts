import test from "node:test";
import assert from "node:assert/strict";
import { portfolioRisk } from "./portfolioRisk";
const position: any = { id: 1, ticker: "C", instrument: null, productType: "SHARE", direction: "LONG",
  entryPrice: 100, shares: 10, positionSizeKr: 1000, stopPrice: 95, indicativeLeverage: null };
test("registered cash and stop scenarios use held instrument, never indicative leverage", () => {
  const product = { ...position, id: 2, instrument: "MINI S BAC", productType: "MINI", ticker: "BAC",
    underlyingTicker: "BAC", underlyingDirection: "SHORT", direction: "SHORT", productSide: "LONG", indicativeLeverage: 12 };
  const input = [position, product], before = JSON.stringify(input);
  const result = portfolioRisk(input);
  assert.equal(result.capital.value, 2000);
  assert.equal(result.stop.value, 100);
  assert.equal(result.maximum.value, 2000);
  assert.equal(result.banks, 2);
  assert.equal(result.rows[1].unbounded, false);
  assert.equal(JSON.stringify(input), before);
});
test("unknown product ownership/stop/leverage/sector stay unknown; instrument shorts are not capped at cash stake", () => {
  const result = portfolioRisk([{ ...position, ticker: "UNKNOWN", stopPrice: null, direction: "SHORT" },
    { ...position, id: 2, ticker: "UNKNOWN2", instrument: "AMBIGUOUS", productSide: null, stopPrice: 95 }]);
  assert.equal(result.stop.unknown, 2);
  assert.equal(result.maximum.unknown, 2);
  assert.equal(result.rows[0].unbounded, true);
  assert.equal(result.rows[1].side, null);
  assert.equal(result.rows[1].leverage, null);
  assert.equal(result.unknownSector, 2);
  assert.equal(result.banks, 0);
});
test("profit-lock stops have zero planned loss, not a guarantee; missing/overflow fields never turn into fabricated totals", () => {
  assert.equal(portfolioRisk([{ ...position, stopPrice: 105 }]).stop.value, 0);
  const r = portfolioRisk([{ ...position, entryPrice: NaN, positionSizeKr: NaN }, { ...position, shares: Number.MAX_VALUE }]);
  assert.equal(r.capital.unknown, 2);
  assert.equal(r.stop.unknown, 2);
  assert.equal(portfolioRisk([]).rows.length, 0);
});
