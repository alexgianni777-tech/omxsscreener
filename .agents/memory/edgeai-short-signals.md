---
name: EdgeAI Short Signals
description: Burry filter constraints, short direction mapping, and why valid output can contain zero shorts.
---

## Burry and Big Short filters

The Burry filter is EdgeAI's dedicated SHORT setup. It looks for an individual
stock that is in its own downtrend, rallies into its short-entry conditions, and
belongs to the weakest third of its market's 63-day relative-strength ranking.
It may be evaluated when the broad index is risk-on; the individual stock must
provide the weakness rather than relying on a global bear-market flag.

**Why:** The former global risk-off gate hid all short candidates whenever the
index was strong, even when individual laggards met a short setup.

**How to apply:** Keep the walk-forward quality gate active. A Burry candidate
must not be emitted merely to produce a daily short pick; tune the strategy
only after its out-of-sample expectancy, profit factor, and sample size support
it. Short track-record resolution must use short-specific stop, target, and R
math.

The Big Short is the broader, independent companion strategy. It requires a
bearish EMA20/EMA50 alignment and a rally near EMA20, but permits a stock near
EMA50, uses a lower RSI threshold, and accepts relative strength up to the
60th percentile. Burry remains capped at the 35th percentile.

**Why:** A strict Burry setup can be rare. A separate broader strategy creates
more opportunities without silently weakening Burry or combining two different
edges in the same performance statistics.

**How to apply:** Each short strategy must retain its own walk-forward
validation. Do not emit Big Short candidates just because its criteria are
broader; its out-of-sample metrics must independently pass the live quality
gate.

## When shorts appear

Short strategies must independently pass their walk-forward quality gates and
freshly trigger for an eligible stock. It is normal for no shorts to qualify;
do not weaken quality gates merely to fill the SHORT group.

**Why:** The broader Big Short strategy is not permission to bypass validation
or force a daily sell suggestion.

**How to apply:** Distinguish generated setups, imported candidates, and
TRADEABLE selections when investigating missing shorts.

## Why a database can show zero shorts

Separate databases can contain different daily snapshots. Re-importing after
EdgeAI has regenerated `data.json` can replace an earlier short-bearing
snapshot with a later file that contains no valid short signals.

**Why:** EdgeAI's `generatedAt` only changes when new signals appear. The data.json is a live file that overwrites previous signals — there's no historical versioning.

## Verification command

```bash
curl -s "https://alexgianni777-tech.github.io/edgeai/public/data.json" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  ['SE','US'].forEach(m => { const s=d.markets[m]?.setups??[]; \
  console.log(m, s.length, 'setups, dirs:', [...new Set(s.map(x=>x.dir))]); })"
```
