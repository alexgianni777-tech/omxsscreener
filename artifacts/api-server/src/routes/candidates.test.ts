import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { resolveOutcome } = await import("./candidates.ts");

const candidate = {
  entryPrice: 100,
  stopPrice: 95,
  targetPrice: 110,
  direction: "LONG",
};

test("confirmed TIME_EXIT accepts the actual exit price rather than matching target or stop", () => {
  assert.deepEqual(
    resolveOutcome(candidate, {
      outcome: "TIME_EXIT",
      resolutionMethod: "TIME_EXIT",
      exitPrice: 103,
      actualExitConfirmed: true,
    }),
    {
      success: true,
      exitPrice: 103,
      realizedR: 0.6,
      resolutionMethod: "TIME_EXIT",
      resolutionQuality: "RECORDED_EXIT",
    },
  );
});

test("TIME_EXIT still requires explicit actual-exit confirmation", () => {
  const result = resolveOutcome(candidate, {
    outcome: "TIME_EXIT",
    resolutionMethod: "TIME_EXIT",
    exitPrice: 103,
  });
  assert.equal(result.success, false);
});

test("TARGET_HIT and STOP_HIT still reject prices that differ from their levels", () => {
  assert.equal(resolveOutcome(candidate, {
    outcome: "WIN",
    resolutionMethod: "TARGET_HIT",
    exitPrice: 109,
  }).success, false);
  assert.equal(resolveOutcome(candidate, {
    outcome: "LOSS",
    resolutionMethod: "STOP_HIT",
    exitPrice: 96,
  }).success, false);
});