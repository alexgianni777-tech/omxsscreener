---
name: EdgeAI pipeline topology
description: The three separate GitHub repos/workflows that feed this app's daily data, and how their crons can miss independently.
---

This app's daily screener data comes from **three separate GitHub repos**, each with its own independent cron schedule under the `alexgianni777-tech` GitHub account:

1. **`omxs30`** — workflow "1 · Daglig screener" runs weekdays at 22:15 in `Europe/Stockholm`, after the normal US close. Sends the daily Telegram message and posts the session to this app's dashboard via a webhook. A miss here means no Telegram message and no auto-created session for the day.
2. **`edgeai`** — workflow "EdgeAI daily" (`.github/workflows/edgeai.yml`, currently cron 06:00 UTC weekdays). Builds and commits `public/data.json` (US + SE market setups). This is the file this app's "Hämta & importera från EdgeAI" button and the (currently disabled) auto-import scheduler consume. A miss here leaves EdgeAI import stale even if the `omxs30` Telegram pipeline ran fine.
3. **`omxsscreener`** — this Replit project's own git mirror/backup repo. Unrelated to daily data delivery.

**Why this matters:** these two data-producing crons (1 and 2) are fully independent GitHub Actions schedules in separate repos. One missing its scheduled trigger says nothing about the other — both must be checked separately when "today's data looks stale" is reported. Both can be manually re-run via the GitHub Actions UI ("Run workflow") or via `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` through the Replit GitHub connector.

**OMXS30 timing rule:** keep the real daily assessment after the US close, currently 22:15 local time with an IANA timezone setting.

**Why:** a morning run fetches fresh Yahoo history but normally sees the same last completed daily candles, making recalculated rankings look nearly identical to the previous day.

**How to apply:** preserve the local-time schedule when editing the external workflow; do not convert it back to a fixed UTC morning cron.

**OMXS30 freshness rule:** the post-close Telegram screener must fail closed if the index bar is not from its report date, even if the stock bars are current. A failed calculation sends only an error alert and must not import partial output into the dashboard.

**Why:** old index bars corrupt market weather and relative-strength rankings, while an ordinary warning left actionable trade plans visible; previously a child-process failure could be treated as a successful notification.

**How to apply:** keep the index-date gate ahead of stock analysis, and keep the notifier's failure branch separate from the normal Telegram/dashboard delivery. Re-run after fresh data arrives; do not silently switch to a different Stockholm index.

**Delayed-run date rule:** determine the report date from the latest completed Stockholm weekday session, not the process UTC date; before evening close, a manual retry belongs to the previous weekday.

**Why:** GitHub's local-evening cron can start after midnight, and an early-morning retry must not reject yesterday's valid index bar just because today's trading has not started.

**How to apply:** when adjusting freshness checks, test both delayed scheduled runs and next-morning manual reruns across local midnight, weekends, and daylight-saving changes.

**Hourly-data caution:** Yahoo's hourly Swedish share bars may have a fresh close while daily stock bars lag, but summed hourly volume can differ materially from the eventual daily volume.

**Why:** using an hourly-derived bar as a complete daily candle would distort volume-based rankings and could make an incomplete trade plan look authoritative.

**How to apply:** don't silently substitute hourly OHLCV for daily OHLCV. If adding a fallback, explicitly mark volume unavailable or otherwise validate it and disclose the reduced data quality.

**Complete-report retry rule:** do not send a Telegram/dashboard screening until the index and every included stock have a closed daily bar for the same report date. Retry missing data quietly, skip already-delivered dates, and allow an explicit historical date if the normal retry window has passed.

**Why:** Yahoo can publish the index daily bar while keeping Swedish stock daily bars a day behind; hourly closes may be fresh but hourly volume does not match the completed daily volume. Re-running without a delivery record can duplicate a trading list.

**How to apply:** treat missing stock data as a failed report, not just an in-message warning. Keep scheduled retries scoped to the pending completed session, and provide an explicit-date backfill path for longer outages rather than relabeling yesterday's prices as today.

**Quiet-retry status rule:** a retry that is merely waiting for Yahoo's completed bars must end without a GitHub failure notification and without marking the report delivered. Unexpected errors must still fail the workflow.

**Why:** suppressing only Telegram errors still makes GitHub email the user on every scheduled retry; treating a waiting retry as successful without gating the delivery marker would permanently skip an unsent report.

**How to apply:** distinguish transient data-not-ready from real failures at the workflow boundary, and keep the delivery-marker step conditional on an actual send.

**Channel-delivery rule:** Telegram delivery and dashboard import are separate states. If Telegram succeeds but the dashboard fails, preserve the exact report and retry only the dashboard; do not generate or send another trading list for that date.

**Why:** the dashboard import can fail independently after Telegram has already accepted a message. Treating both as one success hides a missing dashboard session, while rerunning the whole notification duplicates actionable trade plans.

**How to apply:** base dashboard recovery on the originally sent text, leave a visible pending state until import succeeds, and test the partial-success path without real messages. A crash between external send and durable receipt remains a residual duplicate risk.

**No-data escalation rule:** silent interim retries need one visible late notice if a completed report still cannot be delivered; a waiting retry must not be mistaken for a delivered report.

**Why:** GitHub Actions can start scheduled jobs late, and a quiet waiting status alone leaves the user uncertain whether the report was omitted.

**How to apply:** deduplicate the late notice by report date, keep it separate from trade plans, and leave manual explicit-date backfill available if market data arrives beyond the retry window.

**EdgeAI schedule is separate:** the `edgeai` repository still uses its own 06:00 UTC weekday trigger and needs separate write access to change. Do not assume it follows the `omxs30` schedule.

**Why:** separate GitHub workflows can miss or be delayed independently; a fresh OMXS30 session does not imply a fresh EdgeAI data file.

**How to apply:** check the `edgeai` workflow and `data.json` timestamp independently before diagnosing the import button.

**Rule:** consume and verify `edgeai/public/data.json` through the GitHub Contents API, not `raw.githubusercontent.com`.

**Why:** the raw CDN can serve yesterday's file after a successful commit, and cache-busting query parameters do not reliably bypass that stale copy.

**How to apply:** use the Contents endpoint with GitHub's raw-media Accept header whenever the app or diagnostics need the canonical current file.

**Manual EdgeAI import rule:** a user-triggered import may use the latest valid prior trading-day snapshot and must visibly retain its original signal date; the automatic scheduler remains strict about today's data.

**Why:** weekend and delayed upstream runs make “not today” normal, and the manual button is explicitly used to retrieve both SE and US alternatives. Silently relabeling old signals as today would corrupt history.

**How to apply:** warn when the snapshot is older, accept reasonably recent data (including weekends), reject invalid or excessively old timestamps, and permit US-only snapshots when SE has no setups.

**Workflow-edit permission rule:** the ordinary GitHub connection can edit source files in the external repositories but cannot update `.github/workflows/`. Workflow edits require a separately authorized workflow-write credential.

**Why:** both GitHub API write paths returned HTTP 403 for workflow changes while ordinary code writes succeeded. A repository's contents-write access alone does not authorize workflow-file edits.

**How to apply:** check whether the dedicated workflow-write credential is available; if not, request authorization through the secure secrets flow. Do not confuse a successful source-code commit with a completed schedule repair, and do not dispatch a live trading workflow just to test permissions.
