---
name: Official Top 3 cutoff policy
description: User-chosen fixed Stockholm cutoff and truthful volume provenance.
---

**Rule:** Official mixed-source Top 3 uses both pasted Telegram signals and EdgeAI received before 16:30 Europe/Stockholm. A missing source makes that day's official selection unavailable; later arrivals must not revise the frozen cohort. This time is a fixed user decision, not the OMXS30 close or a relative market-open offset. Preserve the ranking weights while collecting out-of-sample results.

**Why:** The user explicitly selected both sources and 16:30 despite the Swedish market normally closing later. A current-day daily volume bar is not complete at 16:30, so a same-day selection may use only the latest *earlier completed* trading bar as dated context; calling it today's volume would be misleading. Arrival/order and transaction-start timestamps must not masquerade as signal-time evidence.

**How to apply:** For snapshot, import, analytics, or UI changes, keep source participation and actual cutoff evaluation separate from candidate quality; preserve the real observed volume date and show it as prior-day context. Never reconstruct old source sets or calendar/volume observations retrospectively.

**Prior-close context rule:** Keep the existing evening OMXS30 Telegram schedule. EdgeAI generated today may use the OMXS30 index close, RSI, and stock volume from EdgeAI's latest completed Swedish data day (often the previous trading day) as dated market context. This does not turn yesterday's Telegram candidates into today's signals or satisfy the official same-day, two-source Top 3 requirement.

**Why:** The user wants today's EdgeAI trade ideas to remain usable with yesterday's completed OMXS30 prices, not a new preliminary morning Telegram report. Mixing a partial current-day index bar with prior-day stock bars would be misleading.

**How to apply:** Align index context to the SE data-as-of day and verify that day's completed bar; keep signal date, market-data date, and Telegram candidate date distinct. Do not change the 16:30 selection cutoff merely to accommodate prior-close context.

**Preliminary-view decision:** On 2026-10-01 the user explicitly kept the two-source requirement when offered a single-source official fallback. The requested preliminary Top 3 is a separate, changeable pre-cutoff view, not permission to relax official freezing.

**Why:** The attached proposal included single-source fallback, but the user's explicit selection rejected that part. Useful live suggestions must not change the meaning of the official out-of-sample cohort.

**How to apply:** Keep preliminary suggestions out of official performance statistics and historical snapshots. Preserve ranking and eligibility, and expose source completeness rather than treating yesterday's Telegram candidates as today's receipt.