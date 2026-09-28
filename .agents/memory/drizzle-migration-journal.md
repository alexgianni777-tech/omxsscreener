---
name: Drizzle migration journal
description: Distinguish SQL migration files, Drizzle tracking, and live schema state.
---

**Rule:** A migration SQL file without a corresponding Drizzle journal entry is not scheduled for execution. Check the journal, the applied-migrations table, and the live schema separately; none proves the other two.

**Why:** An unregistered additive migration once coexisted with already-present columns in both development and production. Startup reported success even though that SQL file had never been read, which could break a fresh database later. Drizzle Kit's check command also failed when the output directory was absolute because it prepended `./` to that path.

**How to apply:** Register each reviewed SQL file in the ordered journal, use a relative output directory for Drizzle Kit, validate metadata with its check command, and read production schema state without writing to production. Do not backfill data or infer provenance from a missing migration record.