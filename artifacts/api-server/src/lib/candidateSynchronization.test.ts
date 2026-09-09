import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateIdentity,
  effectiveCandidateInputs,
  pendingRemovalIdentities,
  synchronizedSignalSource,
  aggregateSessionSource,
  legacySignalSourceForSession,
} from "./candidateSynchronizationPolicy.ts";
import { reviewCandidate } from "./screeningReview.ts";

type Row = {
  market: "SE" | "US";
  category: "MOMENTUM";
  ticker: string;
  direction: "LONG";
  outcome: "PENDING" | "WIN" | "LOSS";
};

const row = (
  ticker: string,
  market: Row["market"] = "SE",
  outcome: Row["outcome"] = "PENDING",
): Row => ({ market, category: "MOMENTUM", ticker, direction: "LONG", outcome });

test("explicit reimport policy preserves US pending and removes absent SE pending", () => {
  const existing = [row("KEEP"), row("REMOVE"), row("RESOLVED", "SE", "WIN"), row("US-KEEP", "US")];
  const incoming = [row("KEEP")];

  const preview = pendingRemovalIdentities(existing, incoming);
  const effective = effectiveCandidateInputs(incoming, existing);
  const effectiveIdentities = new Set(effective.map(candidateIdentity));
  const actual = existing.filter(
    (candidate) => candidate.outcome === "PENDING" && !effectiveIdentities.has(candidateIdentity(candidate)),
  );

  assert.deepEqual(preview, ["SE|MOMENTUM|REMOVE|LONG"]);
  assert.deepEqual(
    actual.map((candidate) => candidateIdentity(candidate)),
    preview,
  );
});

test("resolved WIN and LOSS rows remain preserved when absent from incoming", () => {
  const existing = [row("WIN", "SE", "WIN"), row("LOSS", "SE", "LOSS")];
  const incoming = [row("NEW")];
  const effective = effectiveCandidateInputs(incoming, existing);

  // synchronizeCandidates only deletes stale PENDING rows; resolved rows are
  // retained even when they are not part of the effective import input.
  const remaining = existing.filter(
    (candidate) =>
      candidate.outcome !== "PENDING" ||
      effective.some((incomingCandidate) => candidateIdentity(incomingCandidate) === candidateIdentity(candidate)),
  );
  assert.deepEqual(remaining.map((candidate) => candidate.ticker), ["WIN", "LOSS"]);
  assert.deepEqual(pendingRemovalIdentities(existing, incoming), []);
});

test("only a genuinely separate market is carried into effective input", () => {
  const existing = [row("OLD-SE"), row("OLD-US", "US")];
  const incoming = [row("NEW-SE")];
  const effective = effectiveCandidateInputs(incoming, existing);

  assert.deepEqual(effective.map((candidate) => candidate.ticker), ["NEW-SE", "OLD-US"]);
  assert.deepEqual(
    pendingRemovalIdentities(existing, incoming),
    ["SE|MOMENTUM|OLD-SE|LONG"],
  );
});

test("mixed-session rows use their own signal provenance for review rules", () => {
  const common = {
    category: "MOMENTUM",
    direction: "LONG",
    rs3m: -1,
    perf1m: -1,
    rsi: 50,
    signalRsi: 50,
    signalGapPct: null,
    volMultiplier: 1,
    earningsInDays: null,
    earningsKnowledge: "SIGNAL_TIME" as const,
    entryPrice: 100,
    stopPrice: 95,
    targetPrice: 110,
    rr: 2,
  };
  const edgeReview = reviewCandidate({ ...common, signalSource: "edgeai" }, "mixed");
  const manualReview = reviewCandidate({ ...common, signalSource: "manual" }, "mixed");
  assert.equal(edgeReview.status, "APPROVED");
  assert.equal(manualReview.status, "BLOCKED");
  assert.match(manualReview.reasons.join(" "), /Momentum/);
});

test("same-identity import persists incoming provenance and aggregate source becomes mixed", () => {
  assert.equal(synchronizedSignalSource("manual", "edgeai"), "manual");
  assert.equal(synchronizedSignalSource(undefined, "edgeai"), "edgeai");
  assert.equal(aggregateSessionSource("edgeai", ["edgeai", "manual"]), "mixed");
  assert.equal(aggregateSessionSource("mixed", ["manual"]), "mixed");
});

test("legacy mixed sessions are not assigned fabricated candidate provenance", () => {
  assert.equal(legacySignalSourceForSession("edgeai"), "edgeai");
  assert.equal(legacySignalSourceForSession("telegram"), "telegram");
  assert.equal(legacySignalSourceForSession(null), "manual");
  assert.equal(legacySignalSourceForSession("mixed"), null);
});