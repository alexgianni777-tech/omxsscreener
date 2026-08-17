---
name: OMXS30 Screener Architecture
description: Key decisions, bug fixes, and data flow for the trading screener system
---

# OMXS30 Screener — Architecture Notes

## Data flow
GitHub Actions screener (alexgianni777-tech/omxs30) → Telegram bot → POST /api/screener/sessions/import (telegramImport.ts)
EdgeAI scheduler (scheduler.ts, every 5 min weekdays 08:00+ UTC) → POST /api/screener/sessions/import-from-edgeai (edgeai.ts)

## Critical field semantics
- `volMultiplier` stores vol ratio (0.3x = 30% of avg). It does NOT store R:R anymore.
- `rr` column stores the actual R:R ratio. analytics.ts must read `c.rr`, not `c.volMultiplier`.
- `market` column = "SE" | "US" | null. Must be set on insert — edgeai.ts tags SE/US before combining allSetups.

## Screener trade plan (as of 2026-08-12)
ATR-relative targets per bucket (not fixed +1%):
- MOMENTUM: target = entry + 2.0×ATR, hold = 10 days
- SQUEEZE: target = entry + 2.5×ATR, hold = 15 days
- STUDS: target = entry + 1.5×ATR, hold = 5 days
- SVAGAST: target = entry + 2.0×ATR, hold = 10 days
Stop always = entry - 1.2×ATR. R/R = targetMult / 1.2 (e.g., 2.0/1.2 ≈ 1.67).

**Why:** Fixed +1% target with 1.2×ATR stop gave R/R 0.24–0.55 on all OMXS30 stocks (ATR 1.5–3.3%). Impossible to have positive expectancy. ATR-relative targets give consistent ~1.67 R/R.

## RSI implementation
Switched from simple 14-bar window average to Wilder's EMA warmup (2026-08-12). Requires closes.length >= 29. Eliminates "RSI rises when price falls" window-rollover artifact.

## EdgeAI staleness guard
edgeai.ts rejects data older than 4 calendar days with 422. Covers Mon morning (Fri's data) plus holiday buffers. If EdgeAI hasn't published in >4 days, no import happens — check manually.

## GitHub PAT issues
The GITHUB_PAT secret in Replit must be a full GitHub classic token (~40 chars, starts with ghp_) or fine-grained token (93+ chars). Users have entered short wrong values. Use the GitHub Replit integration (connection:conn_github_01M07N23478V7V8E5YZKNGFJ93) for API calls from the agent instead of relying on the shell env var.

## Backfill (not yet built as of 2026-08-12)
candidates-log.csv now includes entry, stop, target, rr, holdDays, dir columns. Triple-barrier backfill API endpoint is Task #53.

## holdDays not yet in DB schema
candidates table does not have a hold_days column yet (Task #54). holdDays is computed at import time from BUCKET_PARAMS but not persisted.
