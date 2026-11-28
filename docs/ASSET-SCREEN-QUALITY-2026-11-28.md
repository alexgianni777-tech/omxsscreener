# AG Invest Asset Screen — kvalitetsgranskning, 2026-11-28

## Scope and deployment safety
- All changes are on **research/asset-screen-risk-20261128**, NOT `main`.
- Do not merge, deploy or republish from this branch until complete checks, backup and explicit user approval.
- No Replit credits, no RoboMarkets/API orders, no automatic mini-future recommendations.
- Existing EdgeAI, OMXS30 Screener and published Replit app remain unchanged.

## Findings confirmed by direct code inspection
1. `screenerParser.ts` was swallowing malformed candidate plan errors and could report successful imports with fewer candidates. On this branch it now **fails the import visibly**, instead of silently skipping a candidate that explicitly contains a plan. Existing transaction behavior is preserved.
2. `omxs30TickerMap.ts` mapped Epiroc A to `EPIR-A.ST`. Corrected to `EPI-A.ST`. This does not establish correctness of the whole historical symbol map.
3. Candidate view called delayed/unknown-freshness Yahoo quotes `Live Px`. The branch relabels them `Yahoo Px*` and warns that they are not executable quotations.
4. Layout claimed `System: ONLINE` without a health/datetime check. Branch removes the unsupported health claim.
5. Dashboard formatted zero win rate as missing. Branch now displays zero.
6. Newly added manual **Risk Desk**: based on the underlying share; position sizing at 4/6/8x, maximum configured planned portfolio risk 4%, entry/stop/target validation, assumed round-trip costs, knockout-distance warnings, indicative R/R, no instrument/order integration.

## Verified calculation checks
The standalone Risk Desk calculation logic was exercised in 9 tests via a current branch fetch: 4x and 8x sizing, risk caps, estimated net win, knockout warning, valid/invalid short and invalid risk rejection. **This is not a full TypeScript compile, browser test or deployment test.**

## Blocking work before publication
1. Run `pnpm run typecheck` and `pnpm run build` in an isolated checked-out branch environment, plus server parser regression tests. Keep the deployed build unchanged if tests fail.
2. Back up the database and verify that old imports, manual edits, user login, dashboard, import, session details and survival journaling behave identically.
3. Audit screener data freshness: source date, trading session, latency, missing bars, membership by date, stale/delayed quotes, and symbol mapping. **No unverified live badge**.
4. Verify historical candidates' entry/stop/target consistency and that parsed candidate count matches source report. A provider change should fail closed rather than publish fewer signals.
5. Unit-test instrument cost and knock-out scenarios against real issuer documents. Mini-future leverage changes with price; indicative approximation is not a product quote. Stops can slip or fail; total stake can be lost. No automated Avanza order flow.
6. For deployment: inspect expected branch diff, obtain user sign-off, merge with review, publish only on user command. Replit credits must not be consumed without separate approval.

## Strategic boundary
The screen ranks **underlying OMXS30 shares** and provides price levels and evidence. AG Invest manually chooses whether any separately assessed mini future with 4–8x indicative leverage is suitable. Leverage does not create statistical edge; risk is controlled as a fraction of **account equity**, not the derivative purchase amount.
