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