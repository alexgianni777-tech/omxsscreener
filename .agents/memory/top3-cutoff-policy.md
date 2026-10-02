---
name: Current Top 3 revisions and original statistical cohort
description: Refresh current recommendations on reimport, preserve prior versions and trades, and keep two-source same-day evidence.
---

**Rule:** Current Top 3 recommendations recalculate after reimports with changed signal data. Preserve previous selections as versions and leave registered trades' original entry, stop, target and outcomes untouched. Both Telegram and EdgeAI must still belong to the current Stockholm signal day; do not wait until 16:30. The initial official statistical cohort remains immutable and is distinct from the latest recommendation version.

**Why:** After initially choosing “Lås direkt när båda källorna finns”, the user explicitly confirmed “Ja, uppdatera Top 3 och bevara historiken”. Permanently freezing current recommendations was too restrictive. Updating suggestions is not permission to rewrite trades, relax source requirements or retrospectively improve performance statistics.

**How to apply:** Display the latest recommendation version after import and reload, with older versions available separately. Keep original statistical picks clearly labeled rather than presenting them as the current list. Both sources can yield an empty current selection if nothing qualifies; never substitute older picks. Preserve historical cohorts, ranking, eligibility and dated completed-volume context. Do not reconstruct prior selections or relabel signal dates.

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
arrivals to the original frozen statistical cohort. Later valid signals can enter
a new recommendation version. Preserve existing outcomes and previous versions.