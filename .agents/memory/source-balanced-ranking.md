---
name: Source-balanced candidate ranking
description: Why mixed-source Top 3 selection must rank within provenance before combining candidates
---

**Rule:** Rank EdgeAI, Telegram, manual, and screener candidates within their own source semantics, then interleave the source queues. EdgeAI ranking may use expectancy, sample-size shrinkage, and signal-age decay; non-EdgeAI long/short momentum must respect direction.

**Why:** Legacy columns are overloaded. EdgeAI stores win rate, expectancy, sample N, and signal age in fields that mean price performance, RSI, %B, and distance for Telegram/manual rows. A cross-source formula silently sorts by unit scale, and multiplying win rate by expectancy double-counts hit rate.

**How to apply:** Any Top 3 consumer must either use an explicit manual pick or the shared source-balanced policy. Do not reintroduce a global `perf1m × rsi` sort. A future migration to dedicated EdgeAI columns can replace the storage overload without changing this rule.