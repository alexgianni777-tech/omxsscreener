import assert from "node:assert/strict";
import test from "node:test";
import { decideCandidate, reviewCandidate } from "./screeningReview";
import { resolveQuoteTicker, resolveYahooTicker } from "./omxs30TickerMap";

const candidate = {
  ticker: "SCA-B", market: "SE", signalSource: "telegram", signalDate: "2026-11-06",
  category: "STUDS", direction: "LONG", rsi: 44, pctB: 0.02,
  rs3m: 1, perf1m: 1, signalRsi: 44, signalGapPct: 0,
  volMultiplier: 1, volumeAsOf: "2026-11-05", earningsInDays: null,
  earningsKnowledge: "UNKNOWN" as const, entryPrice: 100, stopPrice: 95,
  targetPrice: 110, rr: 2, price: 100,
};

test("Telegram SCA 44/0.02 stays intact but cannot qualify for STUDS or entry", () => {
  const before = structuredClone(candidate);
  const review = reviewCandidate(candidate, "telegram");
  assert.equal(review.status, "BLOCKED");
  assert.match(review.reasons.join(" "), /Inkonsekvent Telegram-kategori STUDS/);
  assert.equal(decideCandidate(candidate, review, candidate.signalDate,
    new Date("2026-11-06T10:00:00Z")).status, "BLOCKED");
  assert.deepEqual(candidate, before);
});

test("STUDS OR thresholds are strict: either qualifying field suffices", () => {
  for (const [rsi, pctB, blocked] of [[34.99, 0.02, false], [44, -0.01, false], [35, 0, true]]) {
    assert.equal(reviewCandidate({ ...candidate, rsi: Number(rsi), pctB: Number(pctB) }, "telegram").status,
      blocked ? "BLOCKED" : "APPROVED");
  }
});

test("EdgeAI pullback, other categories and unmeasured values are not given a fabricated STUDS failure", () => {
  for (const change of [{ signalSource: "edgeai" }, { category: "MOMENTUM" }, { pctB: null }, { pctB: NaN }]) {
    assert.doesNotMatch(reviewCandidate({ ...candidate, ...change }, "mixed").reasons.join(" "),
      /Inkonsekvent Telegram-kategori STUDS/);
  }
});

test("explicit Swedish share classes are preserved, never chosen from bare names", () => {
  for (const [input, expected] of [["SCA B", "SCA-B.ST"], ["SCA-B", "SCA-B.ST"],
    ["SSAB A", "SSAB-A.ST"], ["SSAB-B.ST", "SSAB-B.ST"], ["ERIC-B", "ERIC-B.ST"]]) {
    assert.equal(resolveYahooTicker(input, "SE"), expected);
  }
  for (const input of ["SCA", "SCA.ST", "SSAB", "SSAB.ST", "Investor", "ATCO"]) {
    assert.throws(() => resolveYahooTicker(input), /kräver instrumentverifiering/);
  }
  assert.match(reviewCandidate({ ...candidate, ticker: "SCA", rsi: 30 }, "telegram").reasons.join(" "),
    /kräver instrumentverifiering/);
});

test("US hyphens stay US, explicit market prevents Swedish name collisions", () => {
  assert.equal(resolveYahooTicker("BRK-B"), "BRK-B");
  assert.equal(resolveYahooTicker("BRK-B", "US"), "BRK-B");
  assert.equal(resolveYahooTicker("BF-B", "US"), "BF-B");
  assert.equal(resolveYahooTicker("ABB", "US"), "ABB");
  assert.equal(resolveYahooTicker("ABB", "SE"), "ABB.ST");
  assert.equal(resolveYahooTicker("SSAB", "US"), "SSAB");
  assert.throws(() => resolveYahooTicker("BRK-B", "SE"), /instrumentverifiering/);
  assert.throws(() => resolveYahooTicker("SCA-B.ST", "US"), /instrumentverifiering/);
});

test("quote request market is preserved: SE:ABB differs from US:ABB, unqualified ABB refuses guessing", () => {
  assert.equal(resolveQuoteTicker("SE:ABB"), "ABB.ST");
  assert.equal(resolveQuoteTicker("US:ABB"), "ABB");
  assert.throws(() => resolveQuoteTicker("ABB"), /instrumentverifiering/);
  assert.throws(() => resolveQuoteTicker("XX:ABB"), /instrumentverifiering/);
  assert.throws(() => resolveQuoteTicker("US:ABB.ST"), /instrumentverifiering/);
  assert.equal(resolveQuoteTicker("ABB.ST"), "ABB.ST");
  assert.equal(resolveQuoteTicker("SE:SCA B"), "SCA-B.ST");
  assert.equal(resolveQuoteTicker("SE:SSAB A"), "SSAB-A.ST");
  assert.equal(resolveQuoteTicker("SE:SSAB-B"), "SSAB-B.ST");
  assert.equal(resolveQuoteTicker("US:BRK-B"), "BRK-B");
  assert.equal(resolveQuoteTicker("BF-B"), "BF-B");
});
