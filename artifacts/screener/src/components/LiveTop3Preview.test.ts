import assert from "node:assert/strict";
import test from "node:test";
import { partitionLiveTop3Picks } from "./LiveTop3Preview";

type PreviewPick = Parameters<typeof partitionLiveTop3Picks>[0][number];
type PreviewCandidate = Parameters<typeof partitionLiveTop3Picks>[1][number];

const pick = (candidateId: number, market: "SE" | "US" = "SE"): PreviewPick => ({
  candidateId,
  rank: 1,
  score: 80,
  market,
  direction: "LONG",
  signalSource: "edgeai",
});

const candidate = (
  id: number,
  ticker: string,
  market: "SE" | "US",
  dataAsOf: string | null,
): PreviewCandidate => ({
  id,
  ticker,
  market,
  entryPrice: 100,
  stopPrice: 95,
  targetPrice: 110,
  rr: 2,
  dataQuality: dataAsOf ? {
    source: "edgeai",
    dataAsOf,
    evidenceStatus: "VERIFIED",
    eliteStatus: null,
    eliteQualified: null,
    validatedEdge: null,
    barSource: "PROVIDER_DAILY",
    fullSessionVerified: true,
    entryEligible: true,
    reasons: [],
  } : null,
  decision: { status: "WAIT", reasons: [] },
});

test("live Top 3 is session-dated OMXS30-only, D−1-fresh, and archives excluded picks", () => {
  const candidates = [
    candidate(1, "INVE-B.ST", "SE", "2026-11-23"),
    candidate(2, "AAPL", "US", "2026-11-23"),
    candidate(3, "MYCR.ST", "SE", "2026-11-23"),
    candidate(4, "LIFCO-B.ST", "SE", "2026-11-23"),
    candidate(5, "SOBI.ST", "SE", "2026-11-23"),
    candidate(6, "TELIA.ST", "SE", null),
    candidate(7, "ABB.ST", "SE", "2026-11-20"),
  ];
  const result = partitionLiveTop3Picks(
    candidates.map((c) => pick(c.id, c.market as "SE" | "US")),
    candidates,
    "2026-11-24",
    false,
  );

  assert.deepEqual(result.activePicks.map((row) => row.candidateId), [1, 4]);
  assert.deepEqual(result.archivedPicks.map((row) => row.pick.candidateId), [2, 3, 5, 6, 7]);
  assert.match(result.archivedPicks.find((row) => row.pick.candidateId === 5)?.reason ?? "", /OMXS30/);
  assert.match(result.archivedPicks.find((row) => row.pick.candidateId === 6)?.reason ?? "", /datadatum saknas/i);
  assert.match(result.archivedPicks.find((row) => row.pick.candidateId === 7)?.reason ?? "", /stale/i);
});

test("OMXS30 membership switches from Lifco B to Sobi on 1 December", () => {
  const candidates = [
    candidate(1, "LIFCO-B.ST", "SE", "2026-11-30"),
    candidate(2, "SOBI.ST", "SE", "2026-11-30"),
  ];
  const result = partitionLiveTop3Picks(
    candidates.map((c) => pick(c.id)),
    candidates,
    "2026-12-01",
    false,
  );

  assert.deepEqual(result.activePicks.map((row) => row.candidateId), [2]);
  assert.equal(result.archivedPicks[0]?.pick.candidateId, 1);
});

test("missing or invalid session date fails closed", () => {
  const one = candidate(1, "INVE-B.ST", "SE", "2026-11-23");
  for (const sessionDate of [undefined, null, "not-a-date"]) {
    const result = partitionLiveTop3Picks([pick(1)], [one], sessionDate, false);
    assert.equal(result.activePicks.length, 0);
    assert.equal(result.archivedPicks.length, 1);
  }
});
