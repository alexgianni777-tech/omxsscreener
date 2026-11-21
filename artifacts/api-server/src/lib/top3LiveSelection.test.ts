import assert from "node:assert/strict";
import test from "node:test";
import { buildTop3LiveSelection } from "./top3LiveSelection.ts";
import { top3CutoffForDate } from "./top3SelectionPolicyCore.ts";
import { pastedSignalSource } from "./pastedSignalSource.ts";

const sessionDate = "2026-09-30";
const beforeCutoff = new Date("2026-09-30T10:00:00.000Z");

const DATA_DATE = "2026-09-29";
const VERIFIED_REPORTS = [{
  status: "SUCCESS",
  dataDates: { SE: DATA_DATE, US: DATA_DATE },
  marketContext: {
    SE: {
      dataAsOf: DATA_DATE,
      indexSnapshot: {
        symbol: "^OMX", asOf: DATA_DATE, priceType: "COMPLETED_DAILY_CLOSE",
        fetchedAt: "2026-09-30T08:00:00.000Z",
        close: 320, sma50: 300, sma200: 280, source: "unit-test-index",
      },
    },
    US: {
      dataAsOf: DATA_DATE,
      indexSnapshot: {
        symbol: "^GSPC", asOf: DATA_DATE, priceType: "COMPLETED_DAILY_CLOSE",
        fetchedAt: "2026-09-30T08:00:00.000Z",
        close: 5500, sma50: 5400, sma200: 5200, source: "unit-test-index",
      },
    },
  },
}];

function testAtrEvidence(ticker: string, market: "SE" | "US") {
  return {
    value: 2, source: "unit-test-ohlcv", market, ticker, dataAsOf: DATA_DATE,
    period: 14, instrumentType: "UNDERLYING_EQUITY", unit: "PRICE",
    timeframe: "1d", method: "WILDER",
  };
}


function candidate(
  id: number,
  overrides: Record<string, unknown> = {},
) {
  const market: "SE" | "US" = overrides.market === "US" ? "US" : "SE";
  const ticker = typeof overrides.ticker === "string" ? overrides.ticker
    : market === "US" ? (id === 2 ? "AAPL" : "MSFT")
      : (["ABB", "EVO", "TELIA", "SAND", "ALFA", "SINCH"][(id - 1) % 6]);
  const source = typeof overrides.signalSource === "string" ? overrides.signalSource : "telegram";
  return {
    id,
    ticker,
    category: "MOMENTUM",
    rank: id,
    market,
    direction: "LONG",
    signalSource: source,
    signalDate: sessionDate,
    createdAt: new Date("2026-09-30T09:30:00.000Z"),
    price: 100,
    perf1m: 4,
    rs3m: 3,
    rsi: 50,
    pctB: 0.5,
    distFrom20dH: 1,
    edgeExpectancyR: null,
    edgeSampleN: null,
    signalAgeBars: null,
    maxHoldDays: 10,
    signalRsi: source === "edgeai" ? 50 : null,
    signalGapPct: null,
    atr: 2,
    dataQuality: { dataAsOf: DATA_DATE, entryEligible: true, eliteQualified: true,
      validatedEdge: true, evidenceStatus: "VALIDATED", eliteStatus: "QUALIFIED",
      atrEvidence: testAtrEvidence(ticker, market) },
    volMultiplier: 1,
    volumeAsOf: DATA_DATE,
    earningsInDays: 30,
    earningsKnowledge: "SIGNAL_TIME",
    entryPrice: 100,
    stopPrice: 95,
    targetPrice: 106,
    rr: 1.2,
    ...overrides,
  } as any;
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    date: sessionDate,
    source: "mixed",
    top3SnapshotAt: null,
    top3CutoffEvaluatedAt: null,
    sourceReports: VERIFIED_REPORTS,
    ...overrides,
  };
}

test("one exact-source receipt can produce a read-only preliminary pick", () => {
  const result = buildTop3LiveSelection(session(), [candidate(1)], beforeCutoff)!;

  assert.equal(result.previewAvailable, true);
  assert.deepEqual(result.sourceReceipts.telegram, {
    received: true,
    candidateCount: 1,
    signalDates: ["2026-09-30"],
    receivedBeforeCutoff: true,
  });
  assert.deepEqual(result.sourceReceipts.edgeai, {
    received: false,
    candidateCount: 0,
    signalDates: [],
    receivedBeforeCutoff: false,
  });
  assert.equal(result.picks.length, 1);
  assert.deepEqual(result.picks[0], {
    candidateId: 1,
    rank: 1,
    score: result.picks[0].score,
    market: "SE",
    direction: "LONG",
    signalSource: "telegram",
  });
  assert.equal(Number.isFinite(result.picks[0].score), true);
});

test("confirmed Telegram paste participates without relabeling prior manual candidates", () => {
  const historicalManual = candidate(1, { signalSource: pastedSignalSource(false) });
  const confirmedPaste = candidate(2, { signalSource: pastedSignalSource(true), origin: "manual" });
  const result = buildTop3LiveSelection(session(), [historicalManual, confirmedPaste], beforeCutoff)!;
  assert.equal(result.sourceReceipts.telegram.candidateCount, 1);
  assert.deepEqual(result.picks.map((pick) => pick.candidateId), [2]);
  assert.equal(historicalManual.signalSource, "manual");
  assert.equal(confirmedPaste.origin, "manual");
});

test("Telegram confirmation cannot make signals older than the previous close into today's receipt", () => {
  const result = buildTop3LiveSelection(session(), [
    candidate(1, { signalSource: pastedSignalSource(true), signalDate: "2026-09-28" }),
  ], beforeCutoff)!;
  assert.equal(result.sourceReceipts.telegram.received, false);
  assert.equal(result.previewAvailable, false);
});

test("WEAKEST negative-expectancy SHORT stays research-only despite the informational exception", () => {
  const result = buildTop3LiveSelection(session(), [candidate(1, {
    signalSource: "edgeai", direction: "SHORT", category: "WEAKEST",
    edgeExpectancyR: -0.32, signalRsi: 50, stopPrice: 105, targetPrice: 94,
  })], beforeCutoff)!;
  assert.equal(result.picks.length, 0, "research-only WEAKEST must not be auto-selected");
  assert.equal(result.sourceReceipts.edgeai.received, true);
});

test("both required-source receipts are reported independently and both may contribute picks", () => {
  const result = buildTop3LiveSelection(session(), [
    candidate(1),
    candidate(2, { signalSource: "edgeai", market: "US" }),
  ], beforeCutoff)!;

  assert.equal(result.previewAvailable, true);
  assert.equal(result.sourceReceipts.telegram.candidateCount, 1);
  assert.equal(result.sourceReceipts.edgeai.candidateCount, 1);
  assert.deepEqual(result.picks.map(({ signalSource }) => signalSource), ["telegram", "edgeai"]);
});

test("missing source does not block preliminary status but is never represented as received", () => {
  const result = buildTop3LiveSelection(session(), [candidate(1)], beforeCutoff)!;

  assert.equal(result.previewAvailable, true);
  assert.equal(result.sourceReceipts.edgeai.received, false);
  assert.equal(result.sourceReceipts.edgeai.candidateCount, 0);
});

test("manual and stale signal rows do not count as today's Telegram or EdgeAI receipts", () => {
  const result = buildTop3LiveSelection(session(), [
    candidate(1, { signalSource: "manual" }),
    candidate(2, { signalSource: "telegram", signalDate: "2026-09-28" }),
    candidate(3, {
      signalSource: "edgeai",
      createdAt: new Date(beforeCutoff.getTime() + 1),
    }),
  ], beforeCutoff)!;

  assert.equal(result.previewAvailable, false);
  assert.equal(result.sourceReceipts.telegram.candidateCount, 0);
  assert.equal(result.sourceReceipts.edgeai.candidateCount, 0);
  assert.deepEqual(result.picks, []);
});

test("a received source with zero tradeable picks remains available without inventing a selection", () => {
  const result = buildTop3LiveSelection(
    session(),
    [candidate(1, { volumeAsOf: null })],
    beforeCutoff,
  )!;

  assert.equal(result.previewAvailable, true);
  assert.equal(result.sourceReceipts.telegram.received, true);
  assert.deepEqual(result.picks, []);
});

test("an unfrozen single-source preview remains visible after the old timed cutoff", () => {
  const cutoff = top3CutoffForDate(sessionDate);
  const before = buildTop3LiveSelection(
    session(),
    [candidate(1, { createdAt: new Date(cutoff.getTime() - 1) })],
    new Date(cutoff.getTime() - 1),
  )!;
  const atCutoff = buildTop3LiveSelection(
    session(),
    [candidate(2, { createdAt: cutoff })],
    cutoff,
  )!;

  assert.equal(before.previewAvailable, true);
  assert.equal(before.sourceReceipts.telegram.receivedBeforeCutoff, true);
  assert.equal(atCutoff.previewAvailable, true);
  assert.equal(atCutoff.sourceReceipts.telegram.received, true);
  assert.equal(atCutoff.sourceReceipts.telegram.receivedBeforeCutoff, true);
  assert.equal(atCutoff.cutoffAt, null);
  assert.equal(atCutoff.picks.length, 1);
});

test("same-day live status remains visible after an official seal but preview picks are suppressed", () => {
  const candidateRows = [candidate(1)];
  for (const seal of [
    { top3SnapshotAt: new Date("2026-09-30T14:30:00.000Z") },
    { top3CutoffEvaluatedAt: new Date("2026-09-30T14:30:00.000Z") },
  ]) {
    const result = buildTop3LiveSelection(session(seal), candidateRows, beforeCutoff)!;
    assert.equal(result.previewAvailable, false);
    assert.equal(result.sourceReceipts.telegram.received, true);
    assert.deepEqual(result.picks, []);
  }
});

test("historical sessions never receive live source status or preliminary picks", () => {
  assert.equal(
    buildTop3LiveSelection(session({ date: "2026-09-29" }), [candidate(1)], beforeCutoff),
    undefined,
  );
});