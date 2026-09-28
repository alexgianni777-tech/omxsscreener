---
name: Official Top 3 cutoff policy
description: User-chosen fixed Stockholm cutoff and truthful volume provenance.
---

**Rule:** Official mixed-source Top 3 uses both pasted Telegram signals and EdgeAI received before 16:30 Europe/Stockholm. A missing source makes that day's official selection unavailable; later arrivals must not revise the frozen cohort. This time is a fixed user decision, not the OMXS30 close or a relative market-open offset. Preserve the ranking weights while collecting out-of-sample results.

**Why:** The user explicitly selected both sources and 16:30 despite the Swedish market normally closing later. A current-day daily volume bar is not complete at 16:30, so a same-day selection may use only the latest *earlier completed* trading bar as dated context; calling it today's volume would be misleading. Arrival/order and transaction-start timestamps must not masquerade as signal-time evidence.

**How to apply:** For snapshot, import, analytics, or UI changes, keep source participation and actual cutoff evaluation separate from candidate quality; preserve the real observed volume date and show it as prior-day context. Never reconstruct old source sets or calendar/volume observations retrospectively.