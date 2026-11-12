# Data chain repair — 2026-11-12

## Confirmed causes

- Canonical EdgeAI data.json: generated 2026-11-11; SE/US market day 2026-11-10.
  The next build rejected a genuine mismatch: index day 2026-11-11 versus
  29 Swedish stocks dated 2026-11-10. No fresh day was fabricated in Replit.
- All 144 current EdgeAI setups had eliteQualified:false / RESEARCH_ONLY.
  Underlying ATR evidence was not supplied by that payload. Those restrictions
  remain; advisory trend data is not permission to trade.
- Telegram had sent markers for November 9–11 but dashboard-pending markers too.
  GitHub omxs30 run 43102254603 logged "Dashboard-import HTTP 404".
  Separately, November 12's run stopped on invalid OHLCV before sending.
  A green GitHub job is therefore not proof of successful dashboard delivery.
- The current published `/api/telegram-import` endpoint rejected an empty,
  unauthenticated POST with 401, as expected. No production import was attempted.
  The previous configured destination cannot be read back from GitHub Secrets,
  so an old host/path versus a previously unavailable deployment is not proven.
- The actual November 11 Telegram report parsed seven candidates but lost its
  explicit common closing-data date. Two bugs contributed: an unrecognized
  phrase and numbered-row normalization splitting the end of an ISO date before
  a sentence beginning with an uppercase letter.
- Market regime expected SMA fields in indexSnapshot, whereas the producer
  supplies them in marketTrendV2.metrics; date-only completed-close timestamps
  were also rejected even with a subsequent fetch timestamp.

## Changes

- Parse the explicit common closing-data phrase; preserve report day separately.
  Prevent ISO date fragments from being normalized into numbered candidate rows.
  Conflicting, invalid, future and absent dates still fail closed.
- Reuse trend SMA values only with matching market/index, day, close, valid
  source and positive finite values. Date-only completed closes require a
  verified fetch timestamp after that market session; missing, future and
  premature observations remain unknown. Contradictory SMA evidence is rejected.
- Group repetitive warning text for presentation only. Historical cards lead
  with the real date gap; original messages remain available in technical details.
  Eligibility, board review and entry safeguards are not relaxed.
- Explain newer imported sessions versus the retained selection, with a link to
  the newer research session. Add a manual report refresh using existing query
  endpoints, without polling or quote requests.
- With explicit user approval, updated omxs30's GitHub Actions DASHBOARD_URL to
  the verified public origin without a trailing slash or API path. GitHub
  accepted the encrypted update with HTTP 204. No import key was read or changed.
  No workflow was dispatched and no Telegram message was sent.

## Verification

- Backend selected regression suites: **87 passed, 0 failed**, including parser,
  source quality, shared UI/API policy, mappings, history, journal and E2E safety.
- Frontend selected regression suites: **49 passed, 0 failed**, including warning
  grouping, retained selection/newer-session messaging, risk and entry guards.
- Backend and frontend TypeScript: passed; shared declaration build passed.
- Backend and frontend production builds: passed. Existing frontend bundle-size
  warning remains (~754 kB main chunk), not a build failure.
- Actual saved GitHub November 11 report, parser only:
  reportDate=2026-11-11, dataAsOf=2026-11-10, candidates=7.
  No database import or historical modification was performed by this check.
- Both existing development workflows restarted successfully.
  Standard development startup reported schema up to date; no migration added.
- Mobile 402×874 screenshot renders the sign-in screen without browser errors.
  This does **not** verify the authenticated cards. Card rendering was covered by
  server-rendered regression tests, not a new authenticated browser test.

## Not yet proven / not changed

- Successful end-to-end delivery after the URL update must be confirmed by the
  next existing run and a matching application receipt. Pending historic reports
  were not manually replayed.
- No claim that source-side stale bars, missing ATR or absent verified report
  dates have been repaired. No upstream strategies or producer code changed.
- No production database DDL/DML, manual production import, order, notification
  or publication performed. Existing production traffic may continue normally.
