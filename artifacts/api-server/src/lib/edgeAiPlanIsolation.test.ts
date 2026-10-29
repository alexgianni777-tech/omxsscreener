import test from "node:test";
import assert from "node:assert/strict";
import { isolateEdgeAiPlans } from "./edgeAiPlanIsolation";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { makeImportReport } from "./importReport";
import { candidateIdentity } from "./candidateSynchronizationPolicy";

const raw = (
  ticker: string,
  setup: string,
  stop: number,
  target: number,
  dir = "long",
  signalT = "Wed Oct 07 2026 08:00:00 GMT+0000 (Coordinated Universal Time)",
  entry = 251,
) => ({ ticker, setup, entry, stop, target, dir, signalT, barsAgo: 6, edge: { winRate: 45, sample: 117 } });
function prepare(input: ReturnType<typeof raw>[]) {
  const rank = {};
  const rows = input.map(s => ({ ...mapEdgeAiSetup(s, "SE", rank), signalSource: "edgeai" }));
  const report = makeImportReport("edgeai", "2026-10-07", { candidates: input });
  return { rows, report, safe: isolateEdgeAiPlans(rows, input.map(s => s.setup), report) };
}
test("GETI-B setups collide in the legacy bucket; neither plan is guessed and an unrelated candidate survives", () => {
  const input = [raw("GETI-B.ST", "Breakout", 244.48, 264.04), raw("GETI-B.ST", "Momentum flag", 234.8, 299.6), raw("VOLV-B.ST", "Breakout", 240, 270)];
  const before = JSON.stringify(input);
  const result = prepare(input);
  assert.equal(result.safe.length, 1);
  assert.equal(result.safe[0].ticker, "VOLV-B");
  assert.deepEqual(result.report.quarantinedIdentities, [candidateIdentity(result.rows[0])]);
  assert.match(result.report.warnings![0], /244.48.*234.8/);
  assert.match(result.report.warnings![0], /Breakout.*Momentum flag/);
  assert.equal(JSON.stringify(input), before);
  const reversed = prepare([...input].reverse());
  assert.deepEqual(reversed.report.quarantinedIdentities, result.report.quarantinedIdentities);
});
test("same-plan duplicates and separate buckets/sides remain valid; invalid short geometry is isolated only locally", () => {
  const a = raw("AZN.ST", "Breakout", 240, 270);
  const valid = prepare([a, a, raw("AZN.ST", "Squeeze", 230, 290), raw("AZN.ST", "Burry", 260, 230, "short")]);
  assert.equal(valid.safe.length, 4);
  assert.deepEqual(valid.report.quarantinedIdentities, []);
  const invalid = prepare([a, raw("ERIC-B.ST", "Burry", 230, 260, "short")]);
  assert.equal(invalid.safe.length, 1);
  assert.match(invalid.report.warnings![0], /ogiltig riskplan/);
});

test("different setup signalT dates do not collide for ERIC-B, ADBE, BKNG or XOM", () => {
  const input = [
    raw("ERIC-B.ST", "Breakout", 104, 118, "long", "Mon Oct 26 2026 08:00:00 GMT+0000 (Coordinated Universal Time)", 110),
    raw("ERIC-B.ST", "Momentum flag", 101, 125, "long", "Tue Oct 27 2026 08:00:00 GMT+0000 (Coordinated Universal Time)", 110),
    raw("ADBE", "Burry", 255, 230, "short", "Tue Oct 27 2026 13:30:00 GMT+0000 (Coordinated Universal Time)", 248),
    raw("ADBE", "Big Short", 258, 225, "short", "Mon Oct 19 2026 13:30:00 GMT+0000 (Coordinated Universal Time)", 248),
    raw("BKNG", "Burry", 167, 153, "short", "Thu Oct 22 2026 13:30:00 GMT+0000 (Coordinated Universal Time)", 161),
    raw("BKNG", "Big Short", 169, 151, "short", "Tue Oct 20 2026 13:30:00 GMT+0000 (Coordinated Universal Time)", 161),
    raw("XOM", "Breakout", 180, 194, "long", "Mon Oct 26 2026 13:30:00 GMT+0000 (Coordinated Universal Time)", 184),
    raw("XOM", "Momentum flag", 178, 198, "long", "Fri Oct 23 2026 13:30:00 GMT+0000 (Coordinated Universal Time)", 184),
  ];
  const result = prepare(input);

  assert.equal(result.safe.length, input.length);
  assert.deepEqual(result.report.quarantinedIdentities, []);
  assert.deepEqual(result.rows.map((row) => row.signalDate), [
    "2026-10-26", "2026-10-27", "2026-10-27", "2026-10-19",
    "2026-10-22", "2026-10-20", "2026-10-26", "2026-10-23",
  ]);
  assert.deepEqual(
    result.rows.map(({ entryPrice, stopPrice, targetPrice }) => ({ entryPrice, stopPrice, targetPrice })),
    input.map(({ entry, stop, target }) => ({ entryPrice: entry, stopPrice: stop, targetPrice: target })),
  );
});

test("same-date conflicts across the eleven warned tickers remain isolated and visible", () => {
  const conflicting = [
    ["ELUX-B", "short"], ["EQT", "short"], ["EVO", "long"], ["HEXA-B", "long"],
    ["TEL2-B", "short"], ["VOLV-B", "short"], ["ACN", "long"], ["COP", "long"],
    ["GE", "short"], ["ISRG", "long"], ["NOW", "long"],
  ] as const;
  const input = conflicting.flatMap(([ticker, direction]) => direction === "long"
    ? [
        raw(ticker, "Breakout", 95, 110, direction),
        raw(ticker, "Momentum flag", 90, 115, direction),
      ]
    : [
        raw(ticker, "Burry", 105, 90, direction),
        raw(ticker, "Big Short", 110, 85, direction),
      ]);
  const result = prepare(input);

  assert.equal(result.safe.length, 0);
  assert.equal(result.report.quarantinedIdentities?.length, 11);
  assert.equal(result.report.warnings?.length, 11);
  for (const [ticker] of conflicting) {
    assert.ok(result.report.warnings?.some((warning) => warning.includes(ticker)));
  }
});
