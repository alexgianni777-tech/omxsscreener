import test from "node:test";
import assert from "node:assert/strict";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { edgeAiDataQuality, textReportQuality } from "./candidateDataQuality";

test("the producer's QUALIFIED_OOS contract is recognized without changing the plan", () => {
  for (const market of ["SE", "US"] as const) {
    for (const dir of ["LONG", "SHORT"]) {
      const setup = {
        ticker: "TEST", dir, setup: "Momentum", entry: 100,
        stop: dir === "LONG" ? 95 : 105, target: dir === "LONG" ? 115 : 85,
        signalT: "2026-11-03T15:00:00Z", barsAgo: 0, rs: 1,
        evidenceStatus: "VALIDATED", eliteStatus: "QUALIFIED_OOS",
        eliteQualified: true, validatedEdge: true,
        edge: { winRate: 80, expectancyR: 0.5, sample: 100 },
      };
      const before = structuredClone(setup);
      const candidate = mapEdgeAiSetup(setup, market, {}, "2026-11-03");
      assert.equal(candidate.dataQuality.entryEligible, true);
      assert.equal(candidate.dataQuality.eliteStatus, "QUALIFIED_OOS");
      assert.equal(candidate.dataQuality.fullSessionVerified, false);
      assert.equal(candidate.dataQuality.barSource, "UNKNOWN");
      assert.equal(candidate.direction, dir);
      assert.equal(candidate.entryPrice, setup.entry);
      assert.equal(candidate.stopPrice, setup.stop);
      assert.equal(candidate.targetPrice, setup.target);
      assert.equal(candidate.rr, 3);
      assert.deepEqual(setup, before);
    }
  }
});

test("QUALIFIED_OOS cannot override missing or contradictory qualification evidence", () => {
  const qualified = {
    evidenceStatus: "VALIDATED", eliteStatus: "QUALIFIED_OOS",
    eliteQualified: true, validatedEdge: true,
  };
  for (const override of [
    { evidenceStatus: "WATCH" }, { evidenceStatus: "PROMISING" },
    { eliteQualified: false }, { eliteQualified: undefined },
    { validatedEdge: false }, { validatedEdge: undefined },
    { evidenceStatus: undefined }, { eliteStatus: "UNKNOWN" },
  ]) {
    assert.equal(edgeAiDataQuality({ ...qualified, ...override }, "2026-11-03").entryEligible, false);
  }
  assert.equal(edgeAiDataQuality(qualified, null).entryEligible, false);
});

test("quality contract preserves WATCH/RESEARCH_ONLY/false and the exact long/short plan", () => {
  for (const dir of ["LONG", "SHORT"]) {
    const setup = { ticker: "TEST.ST", dir, setup: "Momentum", entry: 100, stop: dir === "LONG" ? 95 : 105,
      target: dir === "LONG" ? 110 : 90, signalT: "2026-11-03T10:00:00Z", barsAgo: 0, rs: 1,
      evidenceStatus: "WATCH", eliteStatus: "RESEARCH_ONLY", eliteQualified: false, validatedEdge: false,
      edge: { winRate: 50, expectancyR: 0.1, sample: 20 } };
    const candidate = mapEdgeAiSetup(setup, "SE", {}, "2026-11-03");
    assert.equal(candidate.direction, dir);
    assert.equal(candidate.stopPrice, setup.stop);
    assert.equal(candidate.targetPrice, setup.target);
    assert.equal(candidate.rr, 2);
    assert.equal(candidate.dataQuality.eliteQualified, false);
    assert.equal(candidate.dataQuality.evidenceStatus, "WATCH");
    assert.equal(candidate.dataQuality.eliteStatus, "RESEARCH_ONLY");
    assert.equal(candidate.dataQuality.entryEligible, false);
    assert.equal(candidate.dataQuality.dataAsOf, "2026-11-03");
  }
});

test("report date is never guessed as market date; explicit D-1 is retained and conflicts fail", () => {
  assert.equal(textReportQuality("SCREENER · 2026-11-04", "2026-11-04", ["EVO"]).dataAsOf, null);
  assert.equal(textReportQuality("Datadag: 2026-11-03", "2026-11-04", ["EVO"]).dataAsOf, "2026-11-03");
  for (const text of ["Datadag: 2026-11-05", "Datadag: 2026-11-03\nDataAsOf=2026-11-02", "Datadag: 2026-02-30"]) {
    assert.throws(() => textReportQuality(text, "2026-11-04", ["EVO"]));
  }
});

test("reconstructed data without full-session evidence never becomes verified; exact ticker only", () => {
  const report = textReportQuality("Datadag: 2026-11-03\nREPAIRED_INTRADAY NIBE-B.ST 2026-11-03 O=43 H=44 L=42 C=43 V=100", "2026-11-04", ["NIBE-B", "EVO"]);
  const repaired = report.byTicker.get("NIBE-B")!;
  assert.equal(repaired.barSource, "RECONSTRUCTED_INTRADAY");
  assert.equal(repaired.fullSessionVerified, false);
  assert.equal(repaired.entryEligible, false);
  assert.equal(report.byTicker.get("EVO")!.barSource, "UNKNOWN");
  const summary = textReportQuality("Datadag: 2026-11-03\n⚠ DATAKVALITET: 2 dagsstaplar rekonstruerade från intradagsdata.", "2026-11-04", ["NIBE-B", "EVO"]);
  assert.ok([...summary.byTicker.values()].every(q => !q.entryEligible && !q.fullSessionVerified));
});
