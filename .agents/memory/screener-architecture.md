---
name: OMXS30 Screener Architecture
description: Key decisions, bug fixes, and data flow for the trading screener system
---

# OMXS30 Screener — Architecture Notes

## Data flow
GitHub Actions screener (alexgianni777-tech/omxs30) → Telegram bot → POST /api/screener/sessions/import (telegramImport.ts)
EdgeAI scheduler checks every 5 minutes from the Nasdaq Stockholm open at 09:00 Europe/Stockholm until today's session contains EdgeAI candidates. A pre-existing Telegram session must not stop the check; EdgeAI is merged into it by source.

## Critical field semantics
- `volMultiplier` stores vol ratio (0.3x = 30% of avg). It does NOT store R:R anymore.
- **Volume qualification rule:** use the completed Yahoo daily candle underlying the signal/report, compared with preceding completed trading days. A live partial day or a 10-day/3-month trend is not a substitute; an undated legacy ratio is not verified evidence for a new trading decision.
  **Why:** the user explicitly chose the latest closed day's volume for qualification after Yahoo's previous-day bars were complete but morning live-volume enrichment still labeled valid proposals "Ogiltig data."
  **How to apply:** keep the source candle date attached to the ratio and visible to the trader; if that exact daily bar is unavailable, leave the proposal unqualified rather than silently changing the meaning of "volume."
- `rr` column stores the actual R:R ratio. analytics.ts must read `c.rr`, not `c.volMultiplier`.
- Opening gaps use percentage points (2.9 means 2.9%), matching the 2.5% safety thresholds.
- EdgeAI win rate, expectancy, sample N, and signal age have dedicated nullable fields. Legacy overloaded fields remain only for backward compatibility.

## Time exits
**Rule:** A `TIME_EXIT` requires an entered, explicitly confirmed execution price. Never substitute a Yahoo/live quote.

**Why:** A maximum holding period removes PENDING censoring only if the exit is auditable; inventing a fill would replace one bias with another.

**How to apply:** Persist each new signal's category-based maximum holding period. Include priced time exits in R statistics; leave legacy rows nullable rather than guessing.
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
EdgeAI imports fetch the canonical GitHub repository file, rather than GitHub Pages, because the Pages endpoint can serve an outdated `data.json` after a fresh commit. Manual imports may use a recent prior trading-day snapshot with its original date; invalid or excessively old data remains blocked.

**Why:** A cached upstream signal file must never be stored as today's trade list; this would make signals appear current while omitting newer setups.

**How to apply:** Keep manual and scheduled imports on the shared source helper, with manual imports allowed to warn and use recent snapshots while scheduled imports stay strict. A short is represented only when EdgeAI explicitly supplies `dir: "short"`; no fallback short should be synthesized.

## Historical signal context
**Rule:** market context attached to an imported EdgeAI session must be calculated as of the signal date, never the later import date.

**Why:** importing an older signal with today's OMXS30 close, returns, or RSI introduces look-ahead bias and makes historical evaluation appear more informed than the strategy was at the time.

**How to apply:** cap Yahoo historical queries at the signal date for prior-day snapshots; same-day imports may continue through the current time. Treat earnings history separately because a live quote does not reconstruct what was known on an earlier date.

## Telegram source date versus trading date
**Rule:** a manually pasted Telegram report may be assigned to today's Stockholm trading session while retaining the untouched report text and its original source-data date.

**Why:** the Telegram report can be generated from the prior close and therefore carry yesterday's date, even though its candidates are intended to be traded today. Treating the source date as the session date hides them from today's dashboard.

**How to apply:** keep the override explicit and user-visible, default it on for pasted daily reports, and never apply the same override to strict automated EdgeAI imports or historical imports.

## Candidate-level source provenance
**Rule:** source provenance belongs to each candidate, not only the session, because one session may contain EdgeAI, Telegram, and manual rows.

**Why:** a session-wide source applies the wrong review rules and display semantics after a mixed-market or cross-source re-import.

**How to apply:** stamp every incoming candidate, prefer explicit incoming provenance on replacement, preserve carried rows, and leave ambiguous legacy mixed rows unknown rather than fabricating a source.

## GitHub PAT issues
The GITHUB_PAT secret in Replit must be a full GitHub classic token (~40 chars, starts with ghp_) or fine-grained token (93+ chars). Users have entered short wrong values. Use the GitHub Replit integration (connection:conn_github_01M07N23478V7V8E5YZKNGFJ93) for API calls from the agent instead of relying on the shell env var.

## Backfill (not yet built as of 2026-08-12)
candidates-log.csv includes entry, stop, target, rr, holdDays, and direction columns. Triple-barrier backfill remains to be implemented.

## holdDays not yet in DB schema
The candidate model does not yet persist the calculated holding limit, so automatic time exits cannot be enforced reliably.

## Yahoo Finance calls need their own retry
`yahoo-finance2`'s `yf.quote`/`yf.historical` have no built-in retry. A single transient failure used to zero-fill OMXS30 market weather (RSI/perf → 0, stored permanently on the session) or leave a candidate's `volMultiplier` at its 0 default (blocking the trade). All three import paths (scheduler.ts, edgeai.ts manual import, screener.ts telegram import) now wrap these calls in a small `withRetry` helper (`artifacts/api-server/src/lib/retry.ts`, 3 attempts with backoff) before falling back.

**Why:** the fallback-to-zero behavior is a legitimate last resort (screeningReview correctly flags marketRsi≤0 / volMultiplier≤0), but a bare Yahoo blip shouldn't trigger it — that made "no-trade" and "data quality warning" banners fire far more often than the data actually warranted.

**How to apply:** any new Yahoo Finance call added to an import/enrichment path should go through `withRetry` too, not a bare `await yf.*(...)`.
