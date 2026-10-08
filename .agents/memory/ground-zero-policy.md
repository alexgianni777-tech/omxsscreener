---
name: Manual Ground Zero benchmark
description: Separate benchmark/reconciliation and cumulative cashflows from trading results.
---
Ground Zero is a separate, optional manual account-valuation record, not a reset of Challenge Tracker or trade/journal history. Never infer its latest balance from screening signals, journal P&L, holdings or an old broker observation.

**Why:** The user requested a new official benchmark while preserving all existing history and avoiding automatic Avanza integration or guessed balances.

Keep the chosen benchmark and observed starting balance separate. The initial reconciliation difference is not profit. Development excludes that difference and manually reconciled cumulative net deposits/withdrawals; the chosen benchmark remains the percentage denominator. Unknown cashflows mean unknown adjusted development, not assumed zero.

**Why:** The user explicitly required capital flows and the opening reconciliation difference not to be mistaken for trading returns. Cumulative net flows keep the feature small without adding a separate transaction ledger.

**How to apply:** Append corrected manual valuations rather than overwriting prior ones. Label the result as simple account-value development, not verified trade P&L or time-weighted return. Do not automatically change allocation, risk limits or orders.
