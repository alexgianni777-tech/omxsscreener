---
name: EdgeAI pipeline topology
description: The three separate GitHub repos/workflows that feed this app's daily data, and how their crons can miss independently.
---

This app's daily screener data comes from **three separate GitHub repos**, each with its own independent cron schedule under the `alexgianni777-tech` GitHub account:

1. **`omxs30`** — workflow "1 · Daglig screener" (`.github/workflows/1-screener.yml`, cron ~06:30 UTC weekdays). Sends the daily Telegram message and posts the session to this app's dashboard via a webhook (using `TELEGRAM_IMPORT_SECRET`). A miss here means no Telegram message and no auto-created session for the day.
2. **`edgeai`** — workflow "EdgeAI daily" (`.github/workflows/edgeai.yml`, cron ~06:2x UTC daily). Builds and commits `public/data.json` (US + SE market setups). This is the file this app's "Hämta & importera från EdgeAI" button and the (currently disabled) auto-import scheduler fetch from `raw.githubusercontent.com/alexgianni777-tech/edgeai/main/public/data.json`. A miss here means EdgeAI import stays stuck on "N days old" even if the `omxs30` Telegram pipeline ran fine.
3. **`omxsscreener`** — this Replit project's own git mirror/backup repo. Unrelated to daily data delivery.

**Why this matters:** these two data-producing crons (1 and 2) are fully independent GitHub Actions schedules in separate repos. One missing its scheduled trigger says nothing about the other — both must be checked separately when "today's data looks stale" is reported. Both can be manually re-run via the GitHub Actions UI ("Run workflow") or via `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` through the Replit GitHub connector.

**Freshness check quirk:** after manually dispatching the `edgeai` workflow, `raw.githubusercontent.com` can lag several minutes behind the actual commit (CDN caching survives cache-busting query params for a while). To verify a fresh commit landed immediately, read via the GitHub Contents API (`GET /repos/{owner}/{repo}/contents/{path}?ref=main`) instead of the raw CDN URL.
