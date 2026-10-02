---
name: Official Top 3 source-ready freeze policy
description: Freeze when both current-day sources arrive; preserve legacy timed cohorts and truthful volume provenance.
---

**Rule:** Official mixed-source Top 3 freezes immediately when both Telegram and EdgeAI are present for the same current Stockholm signal day. Do not wait until 16:30. A missing source leaves the session open; later arrivals or reimports cannot revise an already frozen cohort. Preserve ranking weights and all other eligibility rules.

**Why:** The user explicitly replaced the earlier 16:30 rule by choosing “Lås direkt när båda källorna finns”. This is permission to change prospective timing, not to relax the two-source requirement or reconstruct earlier cohorts. Actual receipt/freeze timestamps must not masquerade as signal-time market evidence.

**How to apply:** Show the saved official picks directly after import. Keep source participation separate from candidate quality: both sources can freeze an empty selection if nothing qualifies. Previously frozen or terminally evaluated 16:30 cohorts stay untouched. Preserve observed completed-volume dates as prior-day context; never reconstruct old source sets or observations.

**Prior-close context rule:** Keep the existing evening OMXS30 Telegram schedule. EdgeAI generated today may use the OMXS30 index close, RSI, and stock volume from EdgeAI's latest completed Swedish data day (often the previous trading day) as dated market context. This does not turn yesterday's Telegram candidates into today's signals or satisfy the official same-day, two-source Top 3 requirement.

**Why:** The user wants today's EdgeAI trade ideas to remain usable with yesterday's completed OMXS30 prices, not a new preliminary morning Telegram report. Mixing a partial current-day index bar with prior-day stock bars would be misleading.

**How to apply:** Align index context to the SE data-as-of day and verify that day's completed bar; keep signal date, market-data date, and Telegram candidate date distinct. Do not treat yesterday's Telegram as today's second source merely to trigger an immediate freeze.

**Preliminary-view decision:** The user kept the two-source requirement when offered a single-source official fallback. The preliminary Top 3 remains separate and changeable while waiting for the second source, even after the former 16:30 deadline.

**Why:** The attached proposal included single-source fallback, but the user's explicit selection rejected that part. Useful live suggestions must not change the meaning of the official out-of-sample cohort.

**How to apply:** Keep preliminary suggestions out of official performance statistics and historical snapshots. Preserve ranking and eligibility, and expose source completeness rather than treating yesterday's Telegram candidates as today's receipt.

**Confirmed paste rule:** An authenticated user may explicitly confirm that
a newly pasted report is from Telegram. Treat its source as Telegram while
retaining its manual transport origin and original report date. Unconfirmed
pastes remain manual; prior manual rows are not retrospectively relabeled.

**Why:** The user asked to make confirmed Telegram pastes satisfy source
participation without treating every pasted report as verified Telegram.

**How to apply:** Carry explicit confirmation through initial import and
reimport. Confirmation cannot make yesterday's signals current or add later
arrivals to an already frozen cohort. Preserve existing outcomes and frozen cohorts.