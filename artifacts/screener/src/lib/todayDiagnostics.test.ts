import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveTodayDiagnostics,
  type DiagnosticLiveSelection,
  type TodayDiagnosticCandidate,
} from "./todayDiagnostics";

const DAY = "2026-10-12";
const BEFORE_CUTOFF = "2026-10-12T13:00:00.000Z";
const CUTOFF = "2026-10-12T14:30:00.000Z";

function candidate(
  id: number,
  overrides: Partial<TodayDiagnosticCandidate> = {},
): TodayDiagnosticCandidate {
  return {
    id,
    ticker: `TICK${id}`,
    direction: "LONG",
    market: "SE",
    signalSource: "edgeai",
    signalDate: DAY,
    createdAt: "2026-10-12T12:00:00.000Z",
    decision: { status: "TRADEABLE", reasons: [] },
    ...overrides,
  };
}

test("source-waiting preliminary diagnostics need no 16:30 deadline", () => {
  const short = candidate(80, { direction: "SHORT" });
  const result = deriveTodayDiagnostics({
    sessionDate: DAY, today: DAY,
    candidates: [short],
    live: live({
      cutoffAt: null,
      picks: [{ candidateId: short.id, rank: 1, score: 1, market: "SE", direction: "SHORT", signalSource: "edgeai" }],
    }),
    now: Date.parse("2026-10-12T19:00:00Z"),
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.preliminary.available, true);
  assert.ok(result.preliminary.selectedCounts);
});

function live(overrides: Partial<DiagnosticLiveSelection> = {}): DiagnosticLiveSelection {
  return {
    evaluatedAt: BEFORE_CUTOFF,
    cutoffAt: CUTOFF,
    previewAvailable: true,
    sourceReceipts: {
      edgeai: { received: true, candidateCount: 2 },
      telegram: { received: true, candidateCount: 2 },
    },
    picks: [],
    ...overrides,
  };
}

function derive(
  candidates: TodayDiagnosticCandidate[],
  options: {
    live?: Parameters<typeof deriveTodayDiagnostics>[0]["live"];
    frozen?: Parameters<typeof deriveTodayDiagnostics>[0]["frozen"];
    now?: number;
    sessionDate?: string;
  } = {},
) {
  return deriveTodayDiagnostics({
    sessionDate: options.sessionDate ?? DAY,
    today: DAY,
    candidates,
    live: options.live,
    frozen: options.frozen,
    now: options.now ?? Date.parse(BEFORE_CUTOFF),
  });
}

test("counts both sources, markets, directions, raw statuses, reasons, and persisted selections", () => {
  const candidates = [
    candidate(1),
    candidate(2, {
      direction: "SHORT",
      decision: {
        status: "BLOCKED",
        reasons: [
          "Weak trend",
          "Weak trend",
          "Volume guard",
          "Låg relativ volym (under snitt)",
          "Regel 7 ej bedömbar: saknar data",
          "Target ligger 20% från entry",
        ],
      },
    }),
    candidate(3, { signalSource: "telegram", direction: "LONG", decision: { status: "WAIT", reasons: [] } }),
    candidate(4, { signalSource: "telegram", direction: "SHORT", decision: { status: "STALE", reasons: ["Old"] } }),
    candidate(5, { market: "US", direction: "LONG", decision: { status: "INVALID", reasons: ["Bad price"] } }),
    candidate(6, { signalSource: "telegram", market: "US", direction: "SHORT", decision: { status: "CONFLICT", reasons: ["Opposing signal"] } }),
    candidate(7, {
      signalSource: "telegram",
      market: "US",
      direction: "LONG",
      officialSelection: {
        selected: true,
        source: "telegram",
        market: "US",
        direction: "LONG",
        decision: { status: "TRADEABLE", reasons: [] },
      },
    }),
    candidate(8, {
      signalSource: "manual",
      market: null,
      direction: "SHORT",
      officialSelection: {
        selected: true,
        source: null,
        market: null,
        direction: "SHORT",
        decision: { status: "TRADEABLE", reasons: [] },
      },
    }),
    candidate(9, {
      signalSource: "manual",
      direction: "SHORT",
      decision: { status: "BLOCKED", reasons: ["Manual-only reason"] },
    }),
  ];
  candidates[0].officialSelection = {
    selected: true,
    source: "edgeai",
    market: "SE",
    direction: "LONG",
    decision: { status: "TRADEABLE", reasons: [] },
  };

  const result = derive(candidates, {
    live: live({
      picks: [
        { candidateId: 1, market: "SE", direction: "LONG", signalSource: "edgeai" },
        { candidateId: 3, market: "SE", direction: "LONG", signalSource: "telegram" },
      ],
    }),
    frozen: {
      available: true,
      requiredSources: ["telegram", "edgeai"],
      participatingSources: ["telegram", "edgeai"],
    },
  })!;

  const edgeSe = result.groups.find((group) => group.source === "edgeai" && group.market === "SE")!;
  assert.equal(edgeSe.total, 2);
  assert.deepEqual(edgeSe.LONG, {
    total: 1, tradeable: 1, wait: 0, blocked: 0, invalid: 0, stale: 0, conflict: 0,
  });
  assert.deepEqual(edgeSe.SHORT, {
    total: 1, tradeable: 0, wait: 0, blocked: 1, invalid: 0, stale: 0, conflict: 0,
  });
  assert.deepEqual(edgeSe.raw, { invalid: 0, stale: 0, conflict: 0 });
  const telegramSe = result.groups.find((group) => group.source === "telegram" && group.market === "SE")!;
  assert.equal(telegramSe.SHORT.wait, 1);
  assert.deepEqual(telegramSe.raw, { invalid: 0, stale: 1, conflict: 0 });
  const edgeUs = result.groups.find((group) => group.source === "edgeai" && group.market === "US")!;
  assert.equal(edgeUs.LONG.invalid, 1);
  assert.deepEqual(edgeUs.raw, { invalid: 1, stale: 0, conflict: 0 });
  const telegramUs = result.groups.find((group) => group.source === "telegram" && group.market === "US")!;
  assert.equal(telegramUs.LONG.tradeable, 1);
  assert.equal(telegramUs.SHORT.conflict, 1);
  assert.deepEqual(telegramUs.raw, { invalid: 0, stale: 0, conflict: 1 });
  assert.equal(result.preliminary.selectedCounts?.["edgeai:SE:LONG"], 1);
  assert.equal(result.preliminary.selectedCounts?.["telegram:SE:LONG"], 1);
  assert.equal(result.official.selectedCounts?.["edgeai:SE:LONG"], 1);
  assert.equal(result.official.selectedCounts?.["telegram:US:LONG"], 1);
  assert.deepEqual(result.topShortBlockingReasons, [
    { reason: "Opposing signal", candidateCount: 1 },
    { reason: "Volume guard", candidateCount: 1 },
    { reason: "Weak trend", candidateCount: 1 },
  ]);
  assert.deepEqual(result.outsideMainCounts, [
    { source: "manual", market: "okänd marknad", count: 1 },
    { source: "manual", market: "SE", count: 1 },
  ]);
  assert.deepEqual(result.outsideSelectedCounts, [{
    source: "okänd källa",
    market: "okänd marknad",
    direction: "SHORT",
    preliminary: 0,
    official: 1,
  }]);
});

test("flags a real short-selection inconsistency when a complete preliminary evaluation selected no short in that market", () => {
  const result = derive([
    candidate(1, { direction: "SHORT", signalSource: "edgeai", market: "SE" }),
    candidate(2, { direction: "LONG", signalSource: "telegram", market: "US" }),
  ], { live: live() })!;

  assert.deepEqual(result.issues, [{
    issueId: `${DAY}:preliminary:SE`,
    mode: "preliminary",
    market: "SE",
    eligibleShortCount: 1,
    eligibleSources: ["edgeai"],
  }]);
});

test("available preliminary preview checks a single received source; unavailable official selection has no official error", () => {
  const partialLive = live({
    sourceReceipts: {
      edgeai: { received: true, candidateCount: 1 },
      telegram: { received: false, candidateCount: 0 },
    },
  });
  const result = derive([
    candidate(1, { direction: "SHORT" }),
  ], { live: partialLive, frozen: { available: false, state: "MISSING_SOURCES" } })!;

  assert.deepEqual(result.issues.map(({ mode, market }) => ({ mode, market })), [
    { mode: "preliminary", market: "SE" },
  ]);
  assert.equal(result.sourceState, "partial");
  assert.equal(result.preliminary.available, true);
  assert.equal(result.official.available, false);
  assert.match(result.official.reason!, /källor saknades/);

  const incompleteOfficial = derive([
    candidate(2, {
      direction: "SHORT",
      officialSelection: {
        selected: false,
        source: "edgeai",
        market: "SE",
        direction: "SHORT",
        decision: { status: "TRADEABLE", reasons: [] },
      },
    }),
  ], {
    frozen: {
      available: true,
      requiredSources: ["telegram", "edgeai"],
      participatingSources: ["edgeai"],
    },
  })!;
  assert.deepEqual(incompleteOfficial.issues, []);
});

test("unavailable preliminary preview does not trigger the invariant", () => {
  const result = derive([
    candidate(1, { direction: "SHORT" }),
  ], {
    live: live({
      previewAvailable: false,
      sourceReceipts: {
        edgeai: { received: true, candidateCount: 1 },
        telegram: { received: false, candidateCount: 0 },
      },
    }),
  })!;

  assert.equal(result.preliminary.available, false);
  assert.deepEqual(result.issues, []);
});

test("suppresses all diagnostics for historical sessions", () => {
  assert.equal(derive([candidate(1)], { sessionDate: "2026-10-11" }), null);
});

test("does not evaluate the preliminary invariant after the cutoff", () => {
  const result = derive([
    candidate(1, { direction: "SHORT" }),
  ], {
    live: live(),
    now: Date.parse("2026-10-12T14:31:00.000Z"),
  })!;

  assert.equal(result.preliminary.available, false);
  assert.deepEqual(result.issues, []);
});

test("opposing eligible ticker candidates are both excluded from the short invariant", () => {
  const result = derive([
    candidate(1, { ticker: "ABC.ST", direction: "SHORT", market: "SE" }),
    candidate(2, { ticker: "abc", direction: "LONG", market: "US", signalSource: "telegram" }),
  ], { live: live() })!;

  assert.deepEqual(result.issues, []);
});

test("official diagnostics use frozen decisions, ignore late/no-snapshot rows, and preserve selected dimensions", () => {
  const frozenTradeableButCurrentlyBlocked = candidate(1, {
    direction: "SHORT",
    decision: { status: "BLOCKED", reasons: ["Live status changed"] },
    officialSelection: {
      selected: false,
      source: "edgeai",
      market: "SE",
      direction: "SHORT",
      decision: { status: "TRADEABLE", reasons: [] },
    },
  });
  const frozenBlockedButCurrentlyTradeable = candidate(2, {
    ticker: "OTHER",
    direction: "SHORT",
    signalSource: "telegram",
    market: "US",
    decision: { status: "TRADEABLE", reasons: [] },
    officialSelection: {
      selected: false,
      source: "telegram",
      market: "US",
      direction: "SHORT",
      decision: { status: "BLOCKED", reasons: [] },
    },
  });
  const lateNoSnapshot = candidate(3, {
    ticker: "LATE",
    direction: "SHORT",
    createdAt: "2026-10-12T15:00:00.000Z",
    officialSelection: null,
  });
  const lateFrozenRow = candidate(5, {
    ticker: "LATE-ROW",
    direction: "SHORT",
    createdAt: "2026-10-12T15:00:00.000Z",
    officialSelection: {
      selected: false,
      source: "edgeai",
      market: "SE",
      direction: "SHORT",
      decision: { status: "TRADEABLE", reasons: [] },
    },
  });
  const selectedLateSnapshot = candidate(6, {
    ticker: "LATE-SELECTED",
    direction: "LONG",
    createdAt: "2026-10-12T15:00:00.000Z",
    officialSelection: {
      selected: true,
      source: "edgeai",
      market: "SE",
      direction: "LONG",
      decision: { status: "TRADEABLE", reasons: [] },
    },
  });
  const nonDiagnosticSource = candidate(7, {
    ticker: "MANUAL-SHORT",
    direction: "SHORT",
    signalSource: "manual",
    officialSelection: {
      selected: false,
      source: "manual",
      market: "SE",
      direction: "SHORT",
      decision: { status: "TRADEABLE", reasons: [] },
    },
  });
  const selectedFrozen = candidate(4, {
    ticker: "SELECTED",
    direction: "SHORT",
    signalSource: "telegram",
    market: "US",
    officialSelection: {
      selected: true,
      source: "telegram",
      market: "US",
      direction: "SHORT",
      decision: { status: "TRADEABLE", reasons: [] },
    },
  });

  const result = derive([
    frozenTradeableButCurrentlyBlocked,
    frozenBlockedButCurrentlyTradeable,
    lateNoSnapshot,
    lateFrozenRow,
    selectedLateSnapshot,
    nonDiagnosticSource,
    selectedFrozen,
  ], {
    frozen: {
      available: true,
      cutoffAt: CUTOFF,
      requiredSources: ["telegram", "edgeai"],
      participatingSources: ["telegram", "edgeai"],
    },
  })!;

  assert.equal(result.official.selectedCounts?.["telegram:US:SHORT"], 1);
  assert.equal(result.official.selectedCounts?.["edgeai:SE:LONG"], 1);
  assert.deepEqual(result.issues.map(({ mode, market, eligibleShortCount }) => ({
    mode, market, eligibleShortCount,
  })), [{ mode: "official", market: "SE", eligibleShortCount: 1 }]);
});

test("preliminary invariant excludes candidates imported after the server evaluation time", () => {
  const result = derive([
    candidate(1, { direction: "SHORT", createdAt: "2026-10-12T13:30:00.000Z" }),
  ], { live: live() })!;

  assert.deepEqual(result.issues, []);
});