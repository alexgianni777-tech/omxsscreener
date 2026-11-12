# CASH research verification — 12 November 2026

## Implemented scope

- Pure, source-bound CASH STRONG / CASH WEAK assessment, always research rather than trade qualification.
- Separate collapsed research list below the existing candidate overview; original Top 3 selection and ranking are unchanged. Groups are ordered deterministically, then alphabetically, not by absolute cash amounts across currencies or company sizes.
- Missing inputs stay DATA_MISSING. The app currently passes only ticker/market: no authenticated financial statements or fundamentals adapter were found connected to this feature. It therefore does **not** produce genuine CASH recommendations yet.
- Partial raw inputs, statement periods, currency, scope, debt/lease definition, CFO, capex, FCF, earnings, coverage, valuation, source-document identifiers/publication times and observed as-of remain inspectable.
- Net cash uses cash plus short liquid investments minus interest-bearing debt. Explicitly excluded leases must be supplied and deducted; included leases are never deducted twice. Unknown debt or debt definition does not become zero.
- FCF is explicitly CFO minus nonnegative capex. Current/previous consolidated TTM periods must be consecutive, comparable, in the same currency and for the same issuer. Missing CFO/capex or incompatible metadata cannot yield a cash classification.
- Price trend requires positive finite close/SMA50/SMA200 for the underlying equity, its own market/identity, the latest completed market day and a source published after that session closes. It is not a derivatives trend.
- Valuation must identify its metric, statement period, currency, issuer, actual observation time and separate price-data day.
- Thresholds for valuation, leverage, coverage and statement age must be explicitly supplied in a named policy. Test thresholds exist only in synthetic fixtures; no production “reasonable valuation” thresholds are invented.
- A missing/unverified report date or report within the existing five-trading-day window leaves the case WATCH. Weak cash additionally requires negative deteriorating FCF, measurable leverage, deteriorating coverage and weak earnings/price trend.
- Source metadata must identify a matched source document/feed; manual/unverified claims are not accepted. This function validates supplied metadata, **does not fetch or independently authenticate documents**. Any future source adapter must establish the verification contract before supplying evidence.
- Later observations/publications cannot retrofit a historical decision. The per-signal card explicitly requires an exact historical decision timestamp; current research does not upgrade past signals.
- Synthetic fixtures are TEST_FIXTURE sources and visibly DEMO even in collapsed summaries. No synthetic data is connected to production views.

## Actual checks in this round

- Selected frontend regression suite: **58 passed, 0 failed**, including **8 new CASH tests** (multiple failure cases per test).
- `pnpm --filter @workspace/screener run typecheck`: passed.
- `git diff --check`: passed.
- No backend/shared qualification code was changed. Prior round's 42 backend regressions were **not rerun** here.
- No full production build was run in this bounded CASH round; the planned final release verification remains separate.
- Existing web frontend was restarted once and served cleanly. Screenshot at 402×874: `screenshots/2026-11-12-cash-research-login-mobile.jpg`.
- That browser is unauthenticated and rendered the sign-in screen without console errors. It **does not verify the authenticated CASH layout**. The CASH component and empty-list markup were server-rendered in the new automated tests.

Command:

```sh
pnpm --filter @workspace/db exec tsx --test $(find "$PWD/artifacts/screener/src" -type f \( -name 'assetScreenV2.test.ts' -o -name 'portfolioRisk.test.ts' -o -name 'journalAnalysis.test.ts' -o -name 'ResearchWarnings.test.ts' -o -name 'SwedishResearch.test.ts' -o -name 'liveEntryGuardView.test.ts' -o -name 'quoteMarketIdentity.test.ts' -o -name 'RiskPanel.test.ts' -o -name 'boardReview.test.ts' -o -name 'researchWarnings.test.ts' -o -name 'cashResearch.test.ts' \) -print)
```

## Boundaries and release status

No new dependencies, provider calls, imports, backfills, timers, API workflow restarts, database writes/schema changes, GitHub push or publication were performed for this implementation. Existing independent server schedules were left unchanged.

While checking existing logs, a production Telegram endpoint receipt was observed: 2026-11-12 13:43:52Z, `Session synchronized`, POST `/api/telegram-import`, HTTP 200, candidates 107. This is evidence of an accepted request, **not** a fresh end-to-end audit of its report date, source payload or dashboard. No Telegram request was sent by this CASH verification.

Local feature-branch commit only. Final analytics/net-result checks, complete production builds, final GitHub sync/PR status and a publish recommendation remain in the already planned downstream release work.
