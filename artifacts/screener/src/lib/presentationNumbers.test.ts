import test from "node:test";
import assert from "node:assert/strict";
import { formatPrice, formatRR } from "./presentationNumbers";
test("formats sv-SE with exactly two decimals, unknown otherwise", () => {
  assert.equal(formatRR(2.50931677018634), "2,51");
  assert.equal(formatRR(1.66287878787878), "1,66");
  assert.equal(formatPrice(100), "100,00");
  for (const v of [null, undefined, NaN, Infinity]) { assert.equal(formatPrice(v), "okänt"); assert.equal(formatRR(v), "okänt"); }
});
