import assert from "node:assert/strict";
import test from "node:test";
import { quoteRequestTicker, researchQuoteForMarket } from "./researchQuote";

test("market identity stays distinct in the batch, response lookup and query cache parameter", () => {
  const se = quoteRequestTicker("ABB", "SE"), us = quoteRequestTicker("ABB", "US");
  assert.equal(se, "SE:ABB");
  assert.equal(us, "US:ABB");
  assert.equal([...new Set([se, us])].join(","), "SE:ABB,US:ABB");
  const quotes = { [se]: { yahooTicker: "ABB.ST", livePrice: 100 }, [us]: { yahooTicker: "ABB", livePrice: 10 } };
  assert.equal(quotes[quoteRequestTicker("ABB", "SE")].livePrice, 100);
  assert.equal(quotes[quoteRequestTicker("ABB", "US")].livePrice, 10);
  assert.equal(quoteRequestTicker("ABB", null), "ABB", "unknown market stays unknown for API refusal");
});

test("explicit share classes and US hyphens are preserved and mismatched quotes cannot confirm entry", () => {
  assert.equal(quoteRequestTicker("SCA B", "SE"), "SE:SCA B");
  assert.equal(quoteRequestTicker("SSAB-A", "SE"), "SE:SSAB-A");
  assert.equal(quoteRequestTicker("SSAB-B", "SE"), "SE:SSAB-B");
  assert.equal(quoteRequestTicker("BRK-B", "US"), "US:BRK-B");
  assert.equal(quoteRequestTicker("BF-B", "US"), "US:BF-B");
  assert.match(researchQuoteForMarket("US", { yahooTicker: "ABB.ST" } as any)?.error ?? "", /Ingen entrybekräftelse/);
  assert.match(researchQuoteForMarket("SE", { yahooTicker: "ABB" } as any)?.error ?? "", /Ingen entrybekräftelse/);
});
