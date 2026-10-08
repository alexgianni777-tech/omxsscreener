import test from "node:test";
import assert from "node:assert/strict";
import { isolateEdgeAiPlans } from "./edgeAiPlanIsolation";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { makeImportReport } from "./importReport";
import { candidateIdentity } from "./candidateSynchronizationPolicy";

const raw = (ticker: string, setup: string, stop: number, target: number, dir = "long") =>
  ({ ticker, setup, entry: 251, stop, target, dir, barsAgo: 6, edge: { winRate: 45, sample: 117 } });
function prepare(input: ReturnType<typeof raw>[]) {
  const rank = {};
  const rows = input.map(s => ({ ...mapEdgeAiSetup(s, "SE", rank), signalSource: "edgeai", signalDate: "2026-10-07" }));
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
