---
name: Current Top 3 revisions and original statistical cohort
description: Refresh current recommendations, accept one previous close with truthful dates, preserve prior versions and trades, and require both sources.
---

**Rule:** Current Top 3 recommendations recalculate after reimports with changed signal data. Preserve previous selections as versions and leave registered trades' original entry, stop, target and outcomes untouched. Both Telegram and EdgeAI are required, but reports may be dated today or the preceding weekday close (weekends skipped). Do not wait until 16:30. The initial official statistical cohort remains immutable and is distinct from the latest recommendation version.

**Why:** After initially choosing “Lås direkt när båda källorna finns”, the user explicitly confirmed “Ja, uppdatera Top 3 och bevara historiken”. Permanently freezing current recommendations was too restrictive. Updating suggestions is not permission to rewrite trades, relax source requirements or retrospectively improve performance statistics.

**How to apply:** Display the latest recommendation version after import and reload, with older versions available separately. Keep original statistical picks clearly labeled rather than presenting them as the current list. Both sources can yield an empty current selection if nothing qualifies; never substitute older picks. Preserve historical cohorts, ranking, eligibility and dated completed-volume context. Do not reconstruct prior selections or relabel signal dates.

**Report-delay decision:** The user said “telegram kommer alltid vara från gårdagens stängning” and explicitly requested “acceptera en dags fördröjning”. This overrides the former requirement that each source report itself be dated today.

**Why:** Valid previous-close reports were imported successfully but disappeared from today's source receipts and selection eligibility, which contradicted the user's trading workflow.

**How to apply:** Use today's Stockholm trading/display session while retaining the real report date and market-data date. Show accepted delay explicitly in source diagnostics and recommendations. Apply the same limit to manual and scheduled EdgeAI imports and Telegram pastes/imports. Do not accept unknown dates, future reports or a second previous weekday close, and do not bypass independent risk/quality guards. The weekday policy handles weekends; it does not infer exchange-specific holidays.

**Manual calendar policy:** The user said “strunta i rapportkalender jag kollar det manuellt”. Do not automatically fetch the earnings calendar or use missing calendar evidence or upcoming earnings to block new suggestions. Explicitly label calendar review as the trader's manual responsibility.

**Why:** Accepting report delay while skipping calendar lookups left otherwise usable signals waiting indefinitely on Rule 7. The user chose manual checking instead of adding current-day calendar verification.

**How to apply:** Keep date acceptance, volume, trade-plan, source-completeness, conflict and max-age checks active. Calendar reminders are informational, not WAIT/BLOCKED reasons. Preserve stored observations, prior trades and frozen historical cohorts; record new selection policy separately rather than rewriting past Rule 7 decisions. Never fabricate a calendar observation.

**New-report identity rule:** A newly dated source report is a new signal, not permission to mutate the old registered trade's source date, plan or outcome.

**Why:** A previous-close signal can legitimately be followed by today's refreshed signal within the same trading session. Their execution history must remain distinguishable.

**How to apply:** Keep actual execution records attached to their original signal and let the current recommendation version use the newly arrived source evidence. Unknown legacy provenance remains unknown rather than being retrospectively relabeled.

**Prior-close context rule:** Keep the existing evening OMXS30 Telegram schedule. EdgeAI may use the OMXS30 index close, RSI, and stock volume from its latest completed Swedish data day as dated context. Accepted report delay does not make those prices current or completed intraday bars.

**Why:** The user wants today's EdgeAI trade ideas to remain usable with yesterday's completed OMXS30 prices, not a new preliminary morning Telegram report. Mixing a partial current-day index bar with prior-day stock bars would be misleading.

**How to apply:** Align index context to the SE data-as-of day and verify that day's completed bar. Keep report date, market-data date and trading/display date distinct; an accepted previous-close Telegram report can now legitimately satisfy source participation without being relabeled.

**Preliminary-view decision:** The user kept the two-source requirement when offered a single-source official fallback. The preliminary Top 3 remains separate and changeable while waiting for the second source, even after the former 16:30 deadline.

**Why:** The attached proposal included single-source fallback, but the user's explicit selection rejected that part. Useful live suggestions must not change the meaning of the official out-of-sample cohort.

**How to apply:** Keep single-source preliminary suggestions out of official performance statistics and historical snapshots. Preserve ranking and eligibility, and expose source completeness and original report dates.

**Confirmed paste rule:** An authenticated user may explicitly confirm that
a newly pasted report is from Telegram. Treat its source as Telegram while
retaining its manual transport origin and original report date. Unconfirmed
pastes remain manual; prior manual rows are not retrospectively relabeled.

**Why:** The user asked to make confirmed Telegram pastes satisfy source
participation without treating every pasted report as verified Telegram.

**How to apply:** Carry explicit confirmation through initial import and
reimport. Confirmation cannot rewrite the original report date or add later
arrivals to the original frozen statistical cohort. Later valid signals can enter
a new recommendation version. Preserve existing outcomes and previous versions.

**Persistent display policy:** Keep the last valid saved Top 3 across date
changes, weekends and holidays. Mark the retained list STALE and require live
verification before a new entry. Empty, failed, preliminary or incomplete
versions must never displace it; show their warnings separately.

**Market visibility rule:** Sverige och USA Top 3 Long och Top 3 Short ska synas lika tydligt direkt på startsidan. Visa USA-sektionerna även när giltiga kandidater saknas, med faktiska datum och blockeringsorsaker.

**Why:** The user explicitly requested equal visibility after US research was hidden in disclosures and its stale source dates were mistaken for a missing import.

**How to apply:** Keep four visible groups and mobile shortcuts. Preserve stale saved plans as historical research, never as a verified entry. Missing data must remain unknown; visibility must not relax screening, source-completeness or date guards.

**Why:** The user confirmed that the homepage was hiding a still-valid saved
list before a replacement screening had been imported.

**How to apply:** Automatic GitHub ingestion is live/new-data status only,
not approval to replace the retained recommendation. Accepted manual/Telegram
imports can promote a complete valid version atomically. An older duplicate
report cannot approve a different newer automatic version. Keep frozen official
cohort, current approved recommendation, live candidates and historical outcomes
distinct. Do not guess missing legacy provenance or change historical plans.