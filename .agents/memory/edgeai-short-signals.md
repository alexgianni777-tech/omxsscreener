---
name: EdgeAI Short Signals
description: Burry filter constraints, short direction mapping, and why valid output can contain zero shorts.
---

## Burry filter

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

## How direction is mapped

In both `edgeai.ts` route and `scheduler.ts`:
```js
const direction = s.dir === "short" ? "SHORT" : "LONG";
```
Exact lowercase match. EdgeAI sends `dir: "long"` or `dir: "short"` on each setup object.

## When shorts appear

EdgeAI generates `dir: "short"` only when the Burry filter is both
walk-forward validated and freshly triggered for an eligible weak stock. It is
normal for the daily file to contain zero shorts when no candidate passes both
tests.

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
