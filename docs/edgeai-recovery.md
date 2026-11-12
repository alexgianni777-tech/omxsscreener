# EdgeAI recovery (no production activation performed)

## What changes
- Timer, startup, owner list reads and the machine hook share one five-minute
  coordinator. Concurrent callers await the same operation, including failures.
- Only authenticated administrator list reads trigger request recovery.
  They await completion, so Autoscale cannot freeze the work after responding.
  An upstream error still allows the retained list to load.
- POST `/api/edgeai-sync` accepts the existing Telegram import bearer only.
  It accepts no report, backfill date or override, and sends no Telegram messages.
  It waits for commit; failed checks return 503, unchanged/skipped checks 200.
- Successful report fingerprints survive restarts in source receipts.
  Original report-day receipts also prevent a D-1 report being imported again
  solely because today's session date changed. A transaction rechecks after
  session/report advisory locks. Partial scheduled reports preserve all prior
  candidates; synchronization still protects selected/registered/resolved plans.
- Weekday/from-09:00 Stockholm gating and existing D-1 policy remain unchanged.
  This is not a holiday-calendar replacement.

## Activation requires separate approval/actions
1. Test/review and publish this application; the old production build lacks
   the machine hook. No database schema migration is introduced here.
2. Push `.github/workflows/edgeai-sync.yml` to the correct GitHub default branch.
   Do not replace newer Replit code with older upstream files.
3. Verify existing GitHub `DASHBOARD_URL` is the published URL and existing
   `DASHBOARD_IMPORT_SECRET` matches the app's `TELEGRAM_IMPORT_SECRET`.
   Never paste credential values into chat or logs.
4. Run the workflow manually once after publishing and inspect its status plus
   import receipts. The hourly weekday schedule is only a wake/recovery trigger;
   normal in-process checks remain at most once per five minutes per instance.
   GitHub schedules can be delayed and depend on GitHub Actions availability.

No remote workflow, production import, notification, deployment or schema
change was executed to test this activation. It cannot be proven end-to-end
before the new endpoint is published.

## RSI contract
Wilder RSI(14) needs 15 consecutive valid positive closes. Extra bars continue
the Wilder smoothing; flat = 50, genuine all-gain/all-loss = 100/0. Invalid or
insufficient history = null, not a guessed value. Signal RSI stops at the
original signal bar; an old signal may still lack enough historical bars.
No new Yahoo calls or historical backfill were added for RSI. Existing
historical NULLs and registered trade plans are not rewritten.
