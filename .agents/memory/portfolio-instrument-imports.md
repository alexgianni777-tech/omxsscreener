---
name: Portfolio instrument imports
description: How broker-pasted leveraged instruments are valued and matched on refresh
---

# Portfolio instrument imports

Leveraged instruments such as MINI and TURBO use the last price from the broker paste, not a market quote for their underlying stock. Repeating an import matches on underlying ticker plus instrument name and refreshes quantity and prices while retaining manually maintained trade levels.

**Why:** A quote for the underlying share does not represent the price, P&L, or market value of a leveraged product. Matching on the two identifiers prevents routine broker refreshes from creating duplicate positions.

**How to apply:** Keep pasted instrument price data separate from ordinary equity quotes. Any extension of the broker importer must preserve existing stop, target, notes, and creation date when the same open instrument is refreshed.