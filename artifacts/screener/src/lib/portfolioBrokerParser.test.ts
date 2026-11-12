import assert from "node:assert/strict";
import test from "node:test";
import { parseBrokerExport } from "./portfolioBrokerParser";

test("broker Turbo S holdings import as owned LONG product with SHORT underlying", () => {
  const parsed = parseBrokerExport(
    "TURBO S HEXAGON AVA 32\n77\t+1,16%\t10:37\t40,26\t38,86 SEK\t+108 kr\t+3,60%\t3 100 kr",
  );
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].productSide, "LONG");
  assert.equal(parsed.rows[0].underlyingDirection, "SHORT");
  assert.equal(parsed.rows[0].direction, "SHORT");
});