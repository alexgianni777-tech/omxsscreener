---
name: GitHub sync caution
description: How to reconcile upstream screener fixes when local trading behavior has moved ahead
---

**Rule:** Compare upstream changes with the current local trading behavior before merging. Bring over compatible safety and data-contract changes, but do not replace the local source-aware, fixed-cutoff Top 3 selection with an older single-source implementation.

**Why:** A GitHub branch carried useful compatibility fixes on top of older trade-selection code. A conventional content merge would have risked reversing the locally agreed two-source official selection policy even though the fixes themselves were wanted.

**How to apply:** For future GitHub syncs, check the common ancestor and both import and selection paths before integrating; document what was ported, retain local policy intentionally, and test both provenance and source-separated reporting.