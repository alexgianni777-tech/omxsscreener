import assert from "node:assert/strict";
import test from "node:test";

import { decideCandidate, reviewCandidate } from "./screeningReview.ts";

const edgeCandidate = {
  category: "MOMENTUM",
  direction: "LONG",
  rs3m: 1,
  perf1m: 0.55,
  rsi: -20,
  signalRsi: 50,
  signalGapPct: 0,
  volMultiplier: 1,
  earningsInDays: 10,
  earningsKnowledge: "SIGNAL_TIME" as const,
  entryPrice: 100,
  stopPrice: 95,
  targetPrice: 110,
  rr: 2,
  signalSource: "edgeai",
  price: 100,
};

test("negative EdgeAI expectancy is a trade blocker, not invalid RSI data", () => {
  const review = reviewCandidate(edgeCandidate, "edgeai");
  assert.equal(review.status, "BLOCKED");
  assert.match(review.reasons.join(" "), /Negativ historisk förväntan/);

  const decision = decideCandidate(edgeCandidate, review, new Date().toISOString().slice(0, 10));
  assert.equal(decision.status, "BLOCKED");
  assert.doesNotMatch(decision.reasons.join(" "), /RSI-data saknas/);
});

test("WAIT candidates are not counted as tradable at session level", async () => {
  const { reviewSession } = await import("./screeningReview.ts");
  const session = reviewSession([
    { status: "WARN", reasons: ["Kontroll krävs."] },
    { status: "BLOCKED", reasons: ["Stoppad."] },
  ], 50);
  assert.equal(session.tradableCount, 0);
  assert.equal(session.status, "BLOCKED");
});

test("stale comparison uses the Stockholm calendar date", () => {
  const approved = { status: "APPROVED" as const, reasons: [] };
  const justAfterMidnightStockholm = new Date("2026-07-10T22:30:00.000Z");
  const decision = decideCandidate(
    { ...edgeCandidate, rsi: 20 },
    approved,
    "2026-07-11",
    justAfterMidnightStockholm,
  );
  assert.equal(decision.status, "TRADEABLE");
});