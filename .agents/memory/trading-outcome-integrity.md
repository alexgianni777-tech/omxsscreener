---
name: Trading outcome integrity
description: Methodology rules that keep historical outcomes, earnings context, and Challenge Tracker data honest and synchronized.
---

## Actual versus assumed exits
**Rule:** only a user-confirmed execution price may be described as an actual exit. A live quote, planned target, or planned stop is an observation or assumption and must be labeled as such.

**Why:** treating a quote or planned level as a fill overstates the accuracy of realized-R analytics and can produce outcomes that contradict the actual signed return.

**How to apply:** preserve explicit resolution provenance, validate WIN/LOSS against signed realized R for confirmed fills, and never infer intraday target/stop ordering when the available candles cannot establish it.

## Immutable realized-R inputs
**Rule:** once a trade is resolved, the entry, stop, and direction used as the R denominator are historical facts and must not change during later imports.

**Why:** candidate plans may be refreshed or remapped. Recomputing an old outcome from a newer plan silently rewrites performance history.

**How to apply:** snapshot resolution inputs and use persisted realized R. Legacy reconstruction is allowed only from a recorded exit and frozen resolution inputs, with unknown provenance clearly retained.

## Candidate and Challenge Tracker consistency
**Rule:** candidate outcomes and linked Challenge Tracker records form one financial event and must update atomically from server-authoritative identity, direction, date, and realized-R data.

**Why:** independently trusted client payloads can leave one view showing a win while the other retains an old loss or wrong P&L.

**How to apply:** derive or strictly validate linked values on the server, and reject corrections that cannot safely update both records together.

## Import and outcome serialization
**Rule:** imports and outcome mutations for the same session must share one transaction-scoped lock acquired before authoritative reads.

**Why:** without serialization, an import can read PENDING, an outcome can commit WIN, and the older import snapshot can then restore PENDING while leaving the linked financial record behind.

**How to apply:** keep synchronization, stale deletion, outcome snapshots, and linked Challenge updates inside the same session-lock discipline.

## Historical earnings knowledge
**Rule:** Rule 7 may block a historical candidate only when the earnings observation is known to be contemporaneous with the signal. Current or missing earnings context is unknown, not evidence that the rule passed or failed.

**Why:** current Yahoo earnings data does not reconstruct what was available on an earlier signal date and would introduce hindsight into historical analytics.

**How to apply:** persist observation provenance, exclude unknown observations from Rule 7-adjusted comparisons, and label current context separately without changing the signal-day review.

## Historical Top 3 selection provenance
**Rule:** a Top 3 list recalculated from mutable candidate fields or stars is retrospective analysis, not a point-in-time record of an executable strategy. Never fabricate historical eligibility or picks from their current values.

**Why:** a later import or post-outcome star can change which past candidates appear selected without changing the actual decisions available at signal time, overstating or understating strategy performance.

**How to apply:** official statistics read only immutable signal-time snapshots. Mark earlier sessions without such evidence unavailable rather than recalculating or backfilling their picks. Freeze selected candidate signal and plan inputs against re-imports; a later same-day source may create the first snapshot only if the session was never sealed.

## Legacy signal-source provenance
**Rule:** Missing per-candidate source remains an unknown source, not a source inferred from the session or a later import. Treat source as part of candidate identity, including the unknown case.

**Why:** Mixed sessions and past imports can contain indistinguishable ticker/setup pairs from different sources; retroactively assigning a missing source could silently contaminate outcome history.

**How to apply:** preserve legacy null-source rows separately when importing a known source. Explain any duplicate-looking rows instead of rewriting history without contemporaneous evidence.

## Signal date versus trading date
**Rule:** the date of the original signal belongs to each candidate, not to a mixed-source session. A later trading/display date cannot make an older signal actionable.

**Why:** a manual target-date override once combined old screener and volume data with a newer earnings calendar while making the candidate appear tradeable.

**How to apply:** keep candidate signal-date provenance immutable, evaluate eligibility against that date, and leave unknown legacy dates unknown. A same-day official selection must be based on known same-day signal inputs.

## Execution journal and legacy outcomes
**Rule:** Keep execution evidence separate from the legacy signal-outcome and Challenge accounting until an explicit reconciliation identifies the same financial event. Do not retroactively label old target/stop outcomes REAL or SIMULATED.

**Why:** The user wants a credible, measurable screener, not an apparent edge inferred from signals without confirmed fills, execution times and costs. Separately entered journal evidence must not double-count an existing Challenge event.

**How to apply:** Preserve unknown execution provenance and costs as unknown. Future reconciliation must link records rather than copy their P&L into a second event. Actual late or plan-broken executions remain evidence even when their R cannot be meaningfully established; disclose missing-R counts in later analysis instead of silently excluding those trades.

## Excursion and correlation evidence
**Rule:** MFE/MAE must be unavailable without actual intratrade high/low series;
never estimate either from the exit/closing price. Shared sector exposure is a
qualitative warning, not a measured correlation or a quantified hedge.

**Why:** The user explicitly requires actual execution evidence and forbids
invented excursions, leverage, correlation and stops in risk/analysis views.

**How to apply:** Keep actual net-R cohorts separate from simulated/missed and
legacy unverified outcomes, disclose missing-field counts, and leave absent
currency/FX, financing, barrier and correlation evidence unknown.