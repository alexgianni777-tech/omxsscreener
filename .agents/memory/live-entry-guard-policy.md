---
name: Live entry guard scope and verification
description: Keep live price eligibility distinct from immutable screening and use existing quote data only.
---

**Rule:** Live Entry Guard is a separate price assessment, not permission to rewrite screening decisions, original plans, ranking, registered trades or historical statistics. READY does not authorize a trade or override a stale/blocked signal. Keep manual calendar checks, prior-close EdgeAI data and the SHORT exceptions.

**Why:** The user requested only three cost-conscious improvements: live entry status, current-versus-original R/R and truthful signal/quote provenance. They explicitly rejected a rebuild, paid quote services, faster polling and automatic publishing.

## Quote presentation is not price verification
**Rule:** Keep original D−1/screener prices visually separate from later market
quotes. Missing actual source asOf means “tidpunkt ej verifierad”, never a
guaranteed live quote; a timestamp alone does not guarantee real-time accuracy.
Never substitute fetchedAt for the price timestamp.

**Why:** The user reported confusing presentation and discrepancies versus
Avanza, and explicitly separated UI polish from investigation of prices,
providers, ticker mapping, fallbacks and calculations.

**How to apply:** Use existing values and provenance only in presentation-only
work. Investigate price discrepancies separately with matching instrument and
source time; do not silently “correct” trading data while styling the UI.

**How to apply:** Reuse existing quotes and their actual asOf timestamps; never substitute fetch time or fabricated setup age. Use unknown when revision metadata cannot safely be joined to its original signal.

**Verification lesson:** Server-rendered component tests through the database workspace's tsx runner can use classic JSX and need an explicit React binding, even though Vite's automatic JSX runtime and typechecking pass. Passing the frontend tsconfig alone did not resolve this.

**Why:** This surfaced only when adding server-rendered component tests to a suite that previously tested pure functions.

## Mobile information priority
**Rule:** Prioritize the original plan over status explanations in mobile
candidate cards. Missing live data needs a short, always-visible
non-confirmation warning, not a large repeated safety panel. Preserve the full
rules and diagnostics in accessible disclosures.

**Why:** The user showed that the earlier visual polish still left NIBE/SCA
cards cluttered, with raw floating-point R/R and repeated UNKNOWN warnings.
They explicitly requested compact trading information rather than removing
safety rules or changing prices.

**How to apply:** Review closed cards on a narrow viewport, not just expanded
SSR markup. Treat display formatting and warning placement as presentation
only; never feed formatted numbers back into trading calculations.
