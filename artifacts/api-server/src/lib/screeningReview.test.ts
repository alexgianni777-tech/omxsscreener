import assert from "node:assert/strict";
import test from "node:test";

import { decideCandidate, reviewCandidate } from "./screeningReview.ts";

const edgeCandidate = {
  signalDate: new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()),
  category: "MOMENTUM",
  direction: "LONG",
  rs3m: 1,
  perf1m: 0.55,
  rsi: 50,
  edgeExpectancyR: -0.2,
  edgeSampleN: 100,
  signalAgeBars: 0,
  signalRsi: 50,
  signalGapPct: 0,
  volMultiplier: 1,
  volumeAsOf: "2026-07-10",
  earningsInDays: 10,
  earningsKnowledge: "SIGNAL_TIME" as const,
  entryPrice: 100,
  stopPrice: 95,
  targetPrice: 110,
  rr: 2,
  signalSource: "edgeai",
  price: 100,
};

test("negative EdgeAI expectancy blocks independently of conventional RSI", () => {
  const review = reviewCandidate(edgeCandidate, "edgeai");
  assert.equal(review.status, "BLOCKED");
  assert.match(review.reasons.join(" "), /Negativ historisk förväntan/);

  const decision = decideCandidate(edgeCandidate, review, edgeCandidate.signalDate);
  assert.equal(decision.status, "BLOCKED");
  assert.doesNotMatch(decision.reasons.join(" "), /RSI-data saknas/);
});

test("EdgeAI review prefers dedicated expectancy over legacy RSI compatibility", () => {
  const candidate = { ...edgeCandidate, edgeExpectancyR: 0.1, rsi: -50 };
  const review = reviewCandidate(candidate, "edgeai");
  assert.equal(review.status, "APPROVED");
  const decision = decideCandidate(
    candidate,
    review,
    candidate.signalDate,
  );
  assert.equal(decision.status, "TRADEABLE");
  assert.doesNotMatch(decision.reasons.join(" "), /RSI-data saknas/);
});

test("a fully enriched same-day Telegram candidate is tradeable", () => {
  const signalDate = "2026-07-10";
  const telegramCandidate = {
    signalDate,
    category: "MOMENTUM",
    direction: "LONG",
    rs3m: 1.2,
    perf1m: 2.1,
    rsi: 54,
    signalRsi: 54,
    signalGapPct: 0.8,
    volMultiplier: 1.4,
    volumeAsOf: signalDate,
    earningsInDays: 12,
    earningsKnowledge: "SIGNAL_TIME" as const,
    earningsObservedAt: new Date(`${signalDate}T09:00:00.000Z`),
    entryPrice: 100,
    stopPrice: 95,
    targetPrice: 110,
    rr: 2,
    signalSource: "telegram",
    price: 100,
  };

  const review = reviewCandidate(telegramCandidate, "telegram");
  const decision = decideCandidate(
    telegramCandidate,
    review,
    signalDate,
    new Date(`${signalDate}T10:00:00.000Z`),
  );

  assert.equal(telegramCandidate.signalGapPct, 0.8);
  assert.equal(telegramCandidate.signalRsi, 54);
  assert.equal(telegramCandidate.earningsKnowledge, "SIGNAL_TIME");
  assert.equal(review.status, "APPROVED");
  assert.equal(decision.status, "TRADEABLE");
});

test("legacy EdgeAI expectancy in RSI remains supported when explicit field is absent", () => {
  const { edgeExpectancyR: _expectancy, ...legacyCandidate } = edgeCandidate;
  const legacy = { ...legacyCandidate, rsi: -20 };
  const review = reviewCandidate(legacy, "edgeai");
  assert.equal(review.status, "BLOCKED");
  assert.match(review.reasons.join(" "), /Negativ historisk förväntan \(-0.20R\)/);
});

test("undated legacy volume cannot qualify a trade", () => {
  const undated = { ...edgeCandidate, volumeAsOf: null };
  const review = reviewCandidate(undated, "edgeai");
  assert.equal(review.status, "BLOCKED");
  assert.match(review.reasons.join(" "), /kursdatum är inte verifierat/);
  const decision = decideCandidate(undated, review, "2026-07-11", new Date("2026-07-11T10:00:00Z"));
  assert.equal(decision.status, "INVALID");
  assert.match(decision.reasons.join(" "), /kursdatum saknas/);
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
    { ...edgeCandidate, signalDate: "2026-07-11", rsi: 20 },
    approved,
    "2026-07-11",
    justAfterMidnightStockholm,
  );
  assert.equal(decision.status, "TRADEABLE");
});

test("a later trading target date is stale relative to the immutable source date", () => {
  const approved = { status: "APPROVED" as const, reasons: [] };
  const nextDay = new Date(`${edgeCandidate.signalDate}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const targetDate = nextDay.toISOString().slice(0, 10);
  const decision = decideCandidate(edgeCandidate, approved, targetDate, new Date(`${edgeCandidate.signalDate}T10:00:00.000Z`));
  assert.equal(decision.status, "STALE");
  assert.match(decision.reasons.join(" "), /ligger efter källsignalen/);
});

test("missing source date is stale and cannot be tradeable", () => {
  const approved = { status: "APPROVED" as const, reasons: [] };
  const decision = decideCandidate(
    { ...edgeCandidate, signalDate: null },
    approved,
    edgeCandidate.signalDate,
  );
  assert.equal(decision.status, "STALE");
  assert.match(decision.reasons.join(" "), /saknar verifierat källdatum/);
});

test("volume newer than the original signal cannot qualify under a later trading date", () => {
  const approved = { status: "APPROVED" as const, reasons: [] };
  const decision = decideCandidate(
    { ...edgeCandidate, signalDate: "2026-07-10", volumeAsOf: "2026-07-11" },
    approved,
    "2026-07-10",
    new Date("2026-07-10T10:00:00.000Z"),
  );
  assert.equal(decision.status, "INVALID");
  assert.match(decision.reasons.join(" "), /Volymens avslutade kursdatum/);
});

test("EdgeAI signal age boundary is an eligibility rule, not only a score penalty", () => {
  const approved = { status: "APPROVED" as const, reasons: [] };
  const base = { ...edgeCandidate, maxHoldDays: 10 };
  const beforeExpiry = decideCandidate({ ...base, signalAgeBars: 9 }, approved, base.signalDate);
  const atExpiry = decideCandidate({ ...base, signalAgeBars: 10 }, approved, base.signalDate);
  const afterExpiry = decideCandidate({ ...base, signalAgeBars: 11 }, approved, base.signalDate);
  assert.equal(beforeExpiry.status, "TRADEABLE");
  assert.equal(atExpiry.status, "STALE");
  assert.equal(afterExpiry.status, "STALE");
  assert.match(atExpiry.reasons.join(" "), /maxålder/);
});