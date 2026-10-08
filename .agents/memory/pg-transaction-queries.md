---
name: PostgreSQL transaction query sequencing
description: Avoid parallel query dispatch on the single client held by a Drizzle transaction.
---
Await independent queries sequentially when they share one transaction client. Separate pool connections can still run in parallel.

**Why:** The project's pg runtime warns that issuing client.query while that same client is executing another query is deprecated and will be removed in pg 9. Parallel history-count queries inside a verification transaction exposed this.

**How to apply:** Use sequential awaits rather than Promise.all for queries on the same tx object; this does not apply to unrelated shell commands or different database clients.
