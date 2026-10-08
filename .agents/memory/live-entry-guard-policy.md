---
name: Live entry guard scope and verification
description: Keep live price eligibility distinct from immutable screening and use existing quote data only.
---

**Rule:** Live Entry Guard is a separate price assessment, not permission to rewrite screening decisions, original plans, ranking, registered trades or historical statistics. READY does not authorize a trade or override a stale/blocked signal. Keep manual calendar checks, prior-close EdgeAI data and the SHORT exceptions.

**Why:** The user requested only three cost-conscious improvements: live entry status, current-versus-original R/R and truthful signal/quote provenance. They explicitly rejected a rebuild, paid quote services, faster polling and automatic publishing.

**How to apply:** Reuse existing quotes and their actual asOf timestamps; never substitute fetch time or fabricated setup age. Use unknown when revision metadata cannot safely be joined to its original signal.

**Verification lesson:** Server-rendered component tests through the database workspace's tsx runner can use classic JSX and need an explicit React binding, even though Vite's automatic JSX runtime and typechecking pass. Passing the frontend tsconfig alone did not resolve this.

**Why:** This surfaced only when adding server-rendered component tests to a suite that previously tested pure functions.
