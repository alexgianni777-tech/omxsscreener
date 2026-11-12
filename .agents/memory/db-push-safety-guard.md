---
name: DB push safety guard
description: pnpm --filter @workspace/db run push now runs a destructive-change check before drizzle-kit push, blocking silent column/table drops in production.
---

The Drizzle schema is the schema source of truth. A checked-in SQL migration and an application log saying “migrations complete” do not prove that Replit’s managed development or production schema changed.

`lib/db/package.json`'s `push` script now runs `check-destructive-push` first (`lib/db/scripts/check-destructive-push.ts`). It introspects the live database via `information_schema` and compares it against the Drizzle schema in code (using `getTableConfig`/`is(v, PgTable)` from `drizzle-orm`). If it finds a column or table present in the live DB but absent from the schema, or a column whose live Postgres type doesn't match what the schema expects, it exits non-zero — the deploy's `&&` chain stops before `drizzle-kit push` ever runs, and the app doesn't start with a half-migrated schema.

**Why:** this was the most concrete, safety-critical gap found when auditing the deploy path — `SCHEMA-SAFETY.md` already documented the risk and the safe 3-step rename process, but nothing actually enforced it.

**How to apply:** after changing the Drizzle schema, run the guarded development push and verify the columns through `information_schema`. Production receives the schema diff only through Replit Publish; never add startup DDL or mutate production directly.

## Gap: this guard can't see production's data
`check-destructive-push` only introspects the database it's about to push to (dev). Adding `.notNull()` to a column in the Drizzle schema and backfilling only the *dev* DB's existing NULLs will pass this check and `push` cleanly — but Replit's publish-time flow separately diffs dev vs. prod schema and applies the same `SET NOT NULL` to production, which fails validation if production (a separate, independently-drifted dataset) still has legacy NULLs there.

**Why:** dev and prod are different databases with different histories; a clean dev backfill says nothing about prod's data, and the agent cannot run DDL or backfills against production directly (see `database-migrations-on-publish.md`) — only the Publish flow can, and it only diffs schema, not data.

**How to apply:** before tightening an existing nullable column to `NOT NULL`, run a read-only `executeSql({ environment: "production" })` count of NULLs on that column first. If production still has legitimate legacy NULLs you can't backfill through Publish, keep the column nullable (with a `.default(...)` for new rows) and coalesce the null case defensively at the API-response boundary instead of relying on the DB constraint.
