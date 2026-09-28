---
name: Equity signal risk and owned products
description: Distinguish unleveraged screener risk from held leveraged-product P&L and underlying direction.
---

**Rule:** Keep screener signal sizing and candidate performance in unleveraged equity units. For a held leveraged product, calculate cash P&L from the owned product's price and quantity; record its underlying direction separately. Never multiply product P&L by the indicative leverage.

**Why:** Earlier equity-only scope applied to signal evaluation, but portfolio holdings can contain Turbo S and similar instruments. A held short-underlying product rises in value when its product price rises; treating the underlying SHORT direction as a short position in the product reverses actual cash P&L.

**How to apply:** Use actual entered product price and quantity for holdings. Keep legacy unknown product metadata nullable; only infer owned-product side for unambiguous held instrument labels. Underlying notional exposure needs product ratio and underlying price, so do not pretend direction counts are exposure amounts.