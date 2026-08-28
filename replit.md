# OMXS30 Screener Dashboard

A daily stock screener dashboard for OMXS30 — import raw screener text each day, browse candidates by category, and log trade outcomes over time.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Schema migrations run automatically on startup.** The API server applies all pending Drizzle migration files (`lib/db/migrations/*.sql`) before accepting any requests, using a PostgreSQL advisory lock so concurrent instances don't race. If migrations fail the server refuses to start and logs the error clearly.
- **Adding a column or table**: (1) update `lib/db/src/schema/`, (2) run `pnpm --filter @workspace/db run generate` to produce a new SQL file in `lib/db/migrations/`, (3) commit the SQL file — the next deploy applies it automatically.
- **Manual migration** (e.g. against a specific DB from the shell): `pnpm --filter @workspace/db run push` (interactive) or `pnpm --filter @workspace/db run push-force` (skip confirmations). Prefer the migration-file workflow for production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
