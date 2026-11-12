# Qualification and risk layer verification

## Scope and baseline

Existing feature/asset-screen-2-0 implementation reused rather than rebuilt.
Origin fetched: origin/main remains efe1195, three commits unique to main versus
295 on the feature side at the start of this task.

Reviewed upstream b654aa7 and efe1195 (scheduled/manual Wilder RSI) and 76d59f2
(legacy rows must not prevent EdgeAI merge). The newer local equivalents are
shared fetchOmxsMarketWeather/calculateWilderRsi and persisted report-fingerprint
deduplication. No blind merge or replacement of newer scheduler/import code.

## Existing capabilities verified

- Shared API/UI QUALIFIED / WATCH / BLOCKED / RESEARCH policy.
- Momentum/Squeeze require verified safety evidence; Studs/Weakest remain
  research, including preservation of the source-specific Telegram STUDS rule.
- Market-specific, dated SMA50/SMA200 hierarchy; opposite/neutral regimes WATCH;
  stale, absent or contradictory evidence never becomes verified live READY.
- Unknown/near report date is a separate current qualification blocker, without
  rewriting original historical screening status.
- Manual exceptions and board documentation do not authorize orders or bypass
  source, date, instrument or live-entry gates.
- Existing stop/target/R, real-cost-only net R/R and 20%/4% budget helpers.

## Small remaining corrections

- Explicit NOT_VERIFIED absolute-risk status in the risk panel. Planned stop
  risk is not a maximum-loss guarantee; share shorts can have unbounded loss,
  distinct from buying a bearish mini instrument.
- Display supplied time stop, or unknown when absent/invalid. An original price
  level alone does not prove an ATR/technical stop calculation.
- Missing/malformed cost strings, unzoned timestamps and nonboolean contract
  confirmation return unknown instead of crashing or producing verified net R/R.

## Checks actually run

- Backend focused regression: **42 passed, 0 failed**, six files:
  sharedResearchPolicy, signalDataSanity, sourceMarketContext,
  scheduledReportPolicy, top3SelectionPolicy, candidateSynchronization.
- Frontend focused regression: **50 passed, 0 failed**, ten files including
  qualification, risk budget/costs, risk rendering, quotes/instrument identity,
  retained selection, entry safeguards and board documentation.
- Frontend and backend TypeScript checks passed.
- Four older backend test assertions initially failed because their fixtures
  lacked the now-required ATR/date/regime/report/instrument evidence.
  Fixtures and evaluation time are now explicit; bullish long/bearish short
  eligibility are tested separately. A counter-regime case expects WAIT, while
  two genuinely eligible conflicting directions still expect CONFLICT.
  A legacy source-specific review test now requires BLOCKED for missing report
  proof instead of incorrectly expecting APPROVED. No trading rule was weakened.
- No new full build/browser run: final build/PR remains in the dependent release
  task. Earlier builds do not certify this new small risk-panel amendment.

No import, price collection, backtest, scheduler restart, database modification,
upstream producer modification or publication performed for this assigned task.
Changes saved locally on the existing feature branch; final GitHub synchronization
is left to the dependent release task. CASH ranking and outcome analytics remain
separate dependent deliverables.
