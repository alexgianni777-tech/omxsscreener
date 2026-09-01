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

**EdgeAI schedule is separate:** the `edgeai` repository still uses its own 06:00 UTC weekday trigger and needs separate write access to change. Do not assume it follows the `omxs30` schedule.

**Why:** separate GitHub workflows can miss or be delayed independently; a fresh OMXS30 session does not imply a fresh EdgeAI data file.

**How to apply:** check the `edgeai` workflow and `data.json` timestamp independently before diagnosing the import button.

**Rule:** consume and verify `edgeai/public/data.json` through the GitHub Contents API, not `raw.githubusercontent.com`.

**Why:** the raw CDN can serve yesterday's file after a successful commit, and cache-busting query parameters do not reliably bypass that stale copy.

**How to apply:** use the Contents endpoint with GitHub's raw-media Accept header whenever the app or diagnostics need the canonical current file.

**Manual EdgeAI import rule:** a user-triggered import may use the latest valid prior trading-day snapshot and must visibly retain its original signal date; the automatic scheduler remains strict about today's data.

**Why:** weekend and delayed upstream runs make “not today” normal, and the manual button is explicitly used to retrieve both SE and US alternatives. Silently relabeling old signals as today would corrupt history.

**How to apply:** warn when the snapshot is older, accept reasonably recent data (including weekends), reject invalid or excessively old timestamps, and permit US-only snapshots when SE has no setups.
