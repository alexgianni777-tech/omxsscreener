import assert from "node:assert/strict";
import test from "node:test";
import { screenerSessionsTable, top3SelectionSnapshotsTable } from "@workspace/db";

import {
  candidateIdentity,
  effectiveCandidateInputs,
  pendingRemovalIdentities,
  synchronizedSignalSource,
  aggregateSessionSource,
  legacySignalSourceForSession,
} from "./candidateSynchronizationPolicy.ts";
import {
  pendingCandidatesToRemove,
  preserveCandidateInputs,
  synchronizeCandidates,
} from "./candidateSynchronization.ts";

test("partial legacy machine report never drops existing same-source proposals", () => {
  const old = row("OLDER", "SE", "PENDING", "telegram");
  const refreshed = row("NEWER", "SE", "PENDING", "telegram");
  const retained = preserveCandidateInputs([refreshed], [old]);
  assert.deepEqual(retained.map((candidate) => candidate.ticker), ["NEWER", "OLDER"]);
  assert.deepEqual(pendingRemovalIdentities([old], retained), []);
});
import { reviewCandidate } from "./screeningReview.ts";
import { top3CutoffForDate } from "./top3SelectionPolicyCore.ts";

type Row = {
  market: "SE" | "US";
  signalSource: "edgeai" | "telegram" | "manual" | null;
  category: "MOMENTUM";
  ticker: string;
  direction: "LONG";
  outcome: "PENDING" | "WIN" | "LOSS";
};

const row = (
  ticker: string,
  market: Row["market"] = "SE",
  outcome: Row["outcome"] = "PENDING",
  signalSource: Row["signalSource"] = "edgeai",
): Row => ({ market, signalSource, category: "MOMENTUM", ticker, direction: "LONG", outcome });

function synchronizationTx(
  candidates: any[],
  snapshots: Array<{ candidateId: number; selected: boolean }>,
  incoming: any[],
  session?: any,
) {
  const tx: any = {
    select: () => {
      let selectedTable: unknown;
      const query: any = {
        from(table: unknown) {
          selectedTable = table;
          return query;
        },
        where() {
          return query;
        },
        orderBy() {
          return query;
        },
        then(resolve: (value: any[]) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(
            selectedTable === top3SelectionSnapshotsTable
              ? snapshots.filter((snapshot) => snapshot.selected)
              : selectedTable === screenerSessionsTable
                ? (session ? [session] : [])
              : candidates,
          ).then(resolve, reject);
        },
      };
      return query;
    },
    update: () => ({
      set(values: Record<string, unknown>) {
        return {
          where() {
            const current = candidates.find((candidate) => candidate.ticker === values.ticker);
            if (current) {
              const { id: _incomingId, ...persistedValues } = values;
              Object.assign(current, persistedValues);
            }
            return Promise.resolve();
          },
        };
      },
    }),
    delete: () => ({
      where() {
        const incomingIdentities = new Set(incoming.map(candidateIdentity));
        for (let index = candidates.length - 1; index >= 0; index--) {
          const candidate = candidates[index];
          if (
            candidate.outcome === "PENDING" &&
            !snapshots.some((snapshot) => snapshot.selected && snapshot.candidateId === candidate.id) &&
            !incomingIdentities.has(candidateIdentity(candidate))
          ) {
            candidates.splice(index, 1);
          }
        }
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values(values: any) {
        candidates.push(values);
        return Promise.resolve();
      },
    }),
  };
  return tx;
}

function syncCandidate(id: number, ticker: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sessionId: 77,
    market: "SE",
    signalSource: "manual",
    category: "MOMENTUM",
    ticker,
    direction: "LONG",
    rank: 1,
    entryPrice: 100,
    stopPrice: 95,
    targetPrice: 110,
    outcome: "PENDING",
    ...overrides,
  };
}

test("selected snapshot candidates keep their row and signal plan through reimport", async () => {
  const selectedPresent = syncCandidate(101, "LOCKED", { rank: 1, entryPrice: 100, targetPrice: 110 });
  const selectedAbsent = syncCandidate(102, "SELECTED-ABSENT", { rank: 2, entryPrice: 80 });
  const staleLegacy = syncCandidate(103, "STALE-LEGACY", { rank: 3 });
  const existing = [selectedPresent, selectedAbsent, staleLegacy];
  const incoming = [
    syncCandidate(900, "LOCKED", { rank: 9, entryPrice: 125, targetPrice: 140 }),
  ];
  const preview = pendingCandidatesToRemove(
    existing,
    incoming,
    new Set([101, 102]),
  );

  const { candidates, diff } = await synchronizeCandidates(
    synchronizationTx(existing, [
      { candidateId: 101, selected: true },
      { candidateId: 102, selected: true },
    ], incoming),
    77,
    incoming,
  );

  assert.deepEqual(preview.map((entry) => entry.ticker), ["STALE-LEGACY"]);
  assert.deepEqual(diff.removed.map((entry) => entry.ticker), ["STALE-LEGACY"]);
  assert.deepEqual(diff.updated, []);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.ticker === "LOCKED").map((candidate) => [
      candidate.id,
      candidate.rank,
      candidate.entryPrice,
      candidate.targetPrice,
    ]),
    [[101, 1, 100, 110]],
  );
  assert.ok(candidates.some((candidate) => candidate.id === 102));
});

test("selected snapshot and Today retain the same candidate identity", async () => {
  const original = syncCandidate(201, "TODAY-PICK");
  const snapshot = { candidateId: original.id, selected: true };
  const incoming = [syncCandidate(999, "TODAY-PICK", { entryPrice: 150 })];

  const { candidates } = await synchronizeCandidates(
    synchronizationTx([original], [snapshot], incoming),
    77,
    incoming,
  );

  const todayCandidate = candidates.find((candidate) => candidate.id === snapshot.candidateId);
  assert.ok(todayCandidate);
  assert.equal(todayCandidate.ticker, "TODAY-PICK");
  assert.equal(todayCandidate.entryPrice, 100);
});

test("unsnapshotted legacy candidates retain ordinary update and removal behavior", async () => {
  const existing = [
    syncCandidate(301, "LEGACY-UPDATE", { entryPrice: 100 }),
    syncCandidate(302, "LEGACY-REMOVE"),
  ];
  const incoming = [syncCandidate(999, "LEGACY-UPDATE", { entryPrice: 125 })];

  const { candidates, diff } = await synchronizeCandidates(
    synchronizationTx(existing, [], incoming),
    77,
    incoming,
  );

  assert.equal(candidates.find((candidate) => candidate.id === 301)?.entryPrice, 125);
  assert.deepEqual(diff.updated.map((entry) => entry.ticker), ["LEGACY-UPDATE"]);
  assert.deepEqual(diff.removed.map((entry) => entry.ticker), ["LEGACY-REMOVE"]);
});

test("pre-cutoff reimports may correct source inputs, but post-cutoff updates are frozen", async () => {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const cutoff = top3CutoffForDate(date);
  const original = syncCandidate(310, "COHORT", {
    signalSource: "edgeai",
    signalDate: date,
    createdAt: new Date(cutoff.getTime() - 60 * 60_000),
    entryPrice: 100,
  });
  const beforeCutoffIncoming = [syncCandidate(999, "COHORT", {
    signalSource: "edgeai",
    signalDate: date,
    entryPrice: 125,
  })];
  const txSession = {
    date,
    top3SnapshotAt: null,
    top3CutoffEvaluatedAt: null,
  };
  const preCutoff = await synchronizeCandidates(
    synchronizationTx([original], [], beforeCutoffIncoming, txSession),
    77,
    beforeCutoffIncoming,
    new Date(cutoff.getTime() - 1),
  );

  assert.equal(preCutoff.candidates[0].entryPrice, 125);
  assert.deepEqual(preCutoff.diff.updated.map((entry) => entry.ticker), ["COHORT"]);

  const afterCutoffIncoming = [syncCandidate(1_000, "COHORT", {
    signalSource: "edgeai",
    signalDate: date,
    entryPrice: 150,
  })];
  const postCutoff = await synchronizeCandidates(
    synchronizationTx(preCutoff.candidates, [], afterCutoffIncoming, txSession),
    77,
    afterCutoffIncoming,
    new Date(cutoff.getTime() + 5 * 60_000),
  );
  assert.equal(postCutoff.candidates[0].entryPrice, 125);
  assert.deepEqual(postCutoff.diff.updated, []);
});

test("explicit reimport policy preserves US pending and removes absent SE pending", () => {
  const existing = [row("KEEP"), row("REMOVE"), row("RESOLVED", "SE", "WIN"), row("US-KEEP", "US")];
  const incoming = [row("KEEP")];

  const preview = pendingRemovalIdentities(existing, incoming);
  const effective = effectiveCandidateInputs(incoming, existing);
  const effectiveIdentities = new Set(effective.map(candidateIdentity));
  const actual = existing.filter(
    (candidate) => candidate.outcome === "PENDING" && !effectiveIdentities.has(candidateIdentity(candidate)),
  );

  assert.deepEqual(preview, ["SE|MOMENTUM|REMOVE|LONG|edgeai"]);
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
    ["SE|MOMENTUM|OLD-SE|LONG|edgeai"],
  );
});

test("EdgeAI reimport preserves pending Telegram candidates in the same market", () => {
  const existing = [
    row("OLD-EDGEAI"),
    row("TELEGRAM-KEEP", "SE", "PENDING", "telegram"),
  ];
  const incoming = [row("NEW-EDGEAI")];
  const effective = effectiveCandidateInputs(incoming, existing);

  assert.deepEqual(
    effective.map((candidate) => candidate.ticker),
    ["NEW-EDGEAI", "TELEGRAM-KEEP"],
  );
  assert.deepEqual(
    pendingRemovalIdentities(existing, incoming),
    ["SE|MOMENTUM|OLD-EDGEAI|LONG|edgeai"],
  );
});

test("Telegram reimport preserves pending EdgeAI candidates in the same market", () => {
  const existing = [
    row("OLD-TELEGRAM", "SE", "PENDING", "telegram"),
    row("EDGEAI-KEEP"),
  ];
  const incoming = [row("NEW-TELEGRAM", "SE", "PENDING", "telegram")];
  const effective = effectiveCandidateInputs(incoming, existing);

  assert.deepEqual(
    effective.map((candidate) => candidate.ticker),
    ["NEW-TELEGRAM", "EDGEAI-KEEP"],
  );
  assert.deepEqual(
    pendingRemovalIdentities(existing, incoming),
    ["SE|MOMENTUM|OLD-TELEGRAM|LONG|telegram"],
  );
});

test("same setup from different sources coexists and keeps its resolved outcome", () => {
  const resolvedEdgeAi = row("SAME", "SE", "WIN", "edgeai");
  const incomingTelegram = row("SAME", "SE", "PENDING", "telegram");
  const effective = effectiveCandidateInputs([incomingTelegram], [resolvedEdgeAi]);

  assert.notEqual(candidateIdentity(resolvedEdgeAi), candidateIdentity(incomingTelegram));
  assert.deepEqual(
    effective.map((candidate) => [candidate.signalSource, candidate.outcome]),
    [["telegram", "PENDING"], ["edgeai", "WIN"]],
  );
  assert.deepEqual(pendingRemovalIdentities([resolvedEdgeAi], [incomingTelegram]), []);
});

test("preview keeps legacy null-source provenance distinct from an imported source", () => {
  const legacyPending = row("SAME", "SE", "PENDING", null);
  const staleEdgeAi = row("STALE", "SE", "PENDING", "edgeai");
  const incomingEdgeAi = row("SAME", "SE", "PENDING", "edgeai");

  assert.notEqual(candidateIdentity(legacyPending), candidateIdentity(incomingEdgeAi));
  assert.equal(candidateIdentity(legacyPending), "SE|MOMENTUM|SAME|LONG|<unknown>");
  assert.deepEqual(
    effectiveCandidateInputs([incomingEdgeAi], [legacyPending, staleEdgeAi])
      .map((candidate) => [candidate.ticker, candidate.signalSource]),
    [["SAME", "edgeai"], ["SAME", null]],
  );
  assert.deepEqual(
    pendingRemovalIdentities([legacyPending, staleEdgeAi], [incomingEdgeAi]),
    ["SE|MOMENTUM|STALE|LONG|edgeai"],
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
    volumeAsOf: "2026-07-10",
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