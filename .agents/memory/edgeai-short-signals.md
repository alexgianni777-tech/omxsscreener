---
name: EdgeAI Short Signals
description: When EdgeAI generates short setups, how direction is mapped, and why dev DB may show 0 shorts when prod has them.
---

## How direction is mapped

In both `edgeai.ts` route and `scheduler.ts`:
```js
const direction = s.dir === "short" ? "SHORT" : "LONG";
```
Exact lowercase match. EdgeAI sends `dir: "long"` or `dir: "short"` on each setup object.

## When shorts appear

EdgeAI generates `dir: "short"` for individual stocks that are relatively weak against OMXS30 (category = WEAKEST). It is NOT triggered by a global bearish regime — shorts can appear even in a bullish market if individual stocks lag.

Example: Aug 17, 2026 prod DB had AstraZeneca, Telia, Ericsson as SHORT/WEAKEST while the broader market was trending up.

## Why dev DB shows 0 shorts when prod has them

Dev and prod use separate databases. The dev DB re-imported EdgeAI data *after* EdgeAI updated its data.json, so the short signals were gone. Prod captured them at the right moment.

**Why:** EdgeAI's `generatedAt` only changes when new signals appear. The data.json is a live file that overwrites previous signals — there's no historical versioning.

## Verification command

```bash
curl -s "https://alexgianni777-tech.github.io/edgeai/public/data.json" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  ['SE','US'].forEach(m => { const s=d.markets[m]?.setups??[]; \
  console.log(m, s.length, 'setups, dirs:', [...new Set(s.map(x=>x.dir))]); })"
```
