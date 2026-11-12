import assert from "node:assert/strict";
import test from "node:test";
import { buildTop3SelectionSnapshot } from "./top3SelectionPolicyCore.ts";

function candidate(
  id: number,
  ticker: string,
  direction: "LONG" | "SHORT",
  market: "SE" | "US" = "SE",
  overrides: Record<string, unknown> = {},
) {
  const isShort = direction === "SHORT";
  return {
    id,
    ticker:market==="SE"&&!ticker.endsWith(".ST")?`${ticker}.ST`:ticker,
    category: "MOMENTUM",
    rank: id,
    market,
    direction,
    signalSource: "manual",
    signalDate: currentStockholmDate(),
    price: 100,
    perf1m: isShort ? -1 : 2 + id,
    rs3m: isShort ? -2 : 3,
    rsi: 50,
    atr: 1,
    pctB: 0.5,
    distFrom20dH: 1,
    edgeExpectancyR: null,
    edgeSampleN: null,
    signalAgeBars: null,
    maxHoldDays: 10,
    signalRsi: null,
    signalGapPct: null,
    volMultiplier: 1,
    volumeAsOf: "2026-11-11",
    earningsInDays: 30,
    earningsKnowledge: "SIGNAL_TIME",
    entryPrice: 100,
    stopPrice: isShort ? 105 : 95,
    targetPrice: isShort ? 94 : 106,
    rr: 1.2,
    ...overrides,
  };
}

function currentStockholmDate() {
  return "2026-11-12"; // Fixture and evaluation clock are both pinned.
}
function regimeReports(se="BULLISH",us=se) {
  return (["SE","US"] as const).map(market=>{
    const bear=(market==="SE"?se:us)==="BEARISH";
    return {status:"SUCCESS",dataDates:{[market]:"2026-11-11"},marketContext:{[market]:{
      dataAsOf:"2026-11-11",indexSnapshot:{close:bear?90:110,sma50:bear?95:105,sma200:100,
        source:"DEMO TEST ONLY",asOf:market==="SE"?"2026-11-11T16:30:00Z":"2026-11-11T21:00:00Z"}}}};
  });
}

test("official Top 3 includes only tradeable rows and caps each market/direction at three", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  const sessionDate = currentStockholmDate();
  const candidates = [
    candidate(1, "LONG1", "LONG"),
    candidate(2, "LONG2", "LONG"),
    candidate(3, "LONG3", "LONG"),
    candidate(4, "LONG4", "LONG"),
    candidate(5, "SHORT1", "SHORT"),
    candidate(6, "SHORT2", "SHORT"),
    candidate(7, "SHORT3", "SHORT"),
    candidate(8, "SHORT4", "SHORT"),
    candidate(9, "USLONG1", "LONG", "US"),
    candidate(10, "INVALID", "LONG", "SE", { volumeAsOf: null }),
  ];
  const rows = buildTop3SelectionSnapshot(
    candidates as any,
    100,
    sessionDate,
    null,
    now,
    regimeReports(),
  );
  const shortRows=buildTop3SelectionSnapshot(candidates as any,100,sessionDate,null,now,regimeReports("BEARISH"));
  // Opposite directions must be evaluated with their appropriate market
  // regime, never simultaneously qualified against one bullish snapshot.
  const selected = [...rows.filter(row=>row.selected),...shortRows.filter(row=>row.selected)];
  assert.equal(rows.filter(row=>row.selected&&row.direction==="SHORT").length,0);
  assert.equal(shortRows.filter(row=>row.selected&&row.direction==="LONG").length,0);

  assert.equal(selected.length, 7);
  assert.equal(selected.filter((row) => row.market === "SE" && row.direction === "LONG").length, 3);
  assert.equal(selected.filter((row) => row.market === "SE" && row.direction === "SHORT").length, 3);
  assert.equal(selected.filter((row) => row.market === "US" && row.direction === "LONG").length, 1);
  assert.equal(rows.find((row) => row.candidateId === 10)?.decision.status, "INVALID");
  assert.equal(rows.find((row) => row.candidateId === 10)?.selected, false);
  assert.ok(rows.every((row) => row.policyVersion === "official-top3-v7"));
});

test("opposing directions for the same canonical underlying are neither auto-selected and carry CONFLICT", () => {
  // Control both evaluation and source dates: calendar "yesterday" on a
  // Sunday is Saturday, which is correctly STALE rather than eligible.
  const now = new Date("2026-11-12T10:00:00.000Z");
  const sessionDate = currentStockholmDate();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const rows = buildTop3SelectionSnapshot(
    [
      candidate(1, "SAME.ST", "LONG", "SE", { signalDate: sessionDate }),
      candidate(2, "SAME", "SHORT", "US", { signalDate: sessionDate }),
      candidate(3, "OTHER", "LONG", "SE", { signalDate: sessionDate }),
      candidate(4, "SAME", "SHORT", "SE", { signalDate: yesterday.toISOString().slice(0, 10) }),
      candidate(5, "SAME", "LONG", "SE", { signalDate: sessionDate, volMultiplier: 0 }),
    ] as any,
    101,
    sessionDate,
    null,
    now,
    regimeReports("BULLISH","BEARISH"),
  );

  const sameTicker = rows.filter((row) => row.ticker.startsWith("SAME"));
  assert.equal(sameTicker.filter((row) => row.selected).length, 0);
  assert.equal(sameTicker.find((row) => row.candidateId === 1)?.decision.status, "CONFLICT");
  assert.equal(sameTicker.find((row) => row.candidateId === 2)?.decision.status, "CONFLICT");
  assert.equal(sameTicker.find((row) => row.candidateId === 4)?.decision.status, "WAIT");
  assert.equal(sameTicker.find((row) => row.candidateId === 5)?.decision.status, "INVALID");
  assert.ok(sameTicker.filter((row) => row.candidateId <= 2).every((row) =>
    row.decision.reasons.some((reason) => reason.startsWith("CONFLICT:")),
  ));
  assert.equal(rows.find((row) => row.candidateId === 3)?.selected, true);
});

test("snapshot captures the selected-at signal-time policy result independent of stars", () => {
  const signalTime = new Date("2026-11-12T10:00:00Z");
  const rows = buildTop3SelectionSnapshot(
    [candidate(1, "LOCKED", "LONG", "SE", { isTop3Pick: true })] as any,
    102,
    currentStockholmDate(),
    null,
    signalTime,
    regimeReports(),
  );
  assert.equal(rows[0].selected, true);
  assert.equal(rows[0].selectedAt, signalTime);
  assert.equal(rows[0].type, "AUTO");
});

test("Top 3 refuses later target dates and candidates without source dates", () => {
  const signalDate = currentStockholmDate();
  const nextDay = new Date(`${signalDate}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const targetDate = nextDay.toISOString().slice(0, 10);
  const rows = buildTop3SelectionSnapshot(
    [
      candidate(1, "LATER_TARGET", "LONG", "SE", { signalDate }),
      candidate(2, "UNKNOWN_SOURCE_DAY", "LONG", "SE", { signalDate: null }),
    ] as any,
    103,
    targetDate,
    null,
    new Date(`${signalDate}T10:00:00.000Z`),
  );
  assert.equal(rows.find((row) => row.candidateId === 1)?.decision.status, "STALE");
  assert.equal(rows.find((row) => row.candidateId === 1)?.selected, false);
  assert.equal(rows.find((row) => row.candidateId === 2)?.decision.status, "STALE");
  assert.equal(rows.find((row) => row.candidateId === 2)?.selected, false);
});