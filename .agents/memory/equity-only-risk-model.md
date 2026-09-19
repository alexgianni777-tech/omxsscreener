---
name: Equity-only risk model
description: Scope decision for portfolio exposure, costs, and future risk calculations
---

**Rule:** Model screener candidates and portfolio positions as unleveraged shares. Do not add leverage ratios, derivative exposure, turbo/minifuture financing, or underlying-exposure estimates.

**Why:** The user wants the application to evaluate pure equities and handles any leverage separately.

**How to apply:** Keep position value, stop risk, costs, and currency conversion based on the entered share position. Future performance improvements may include equity brokerage and FX costs, but must not infer or request leverage.