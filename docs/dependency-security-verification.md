# Dependency security verification

## Scope

Updated dependency manifests and the pnpm lockfile to remediate the 56 findings
reported by the dependency audit. No application trading rules, source data,
database schema, import implementation or historical results were edited.

The changes include Express 5.3.0, Vite 7.3.8, Zod 4.6.7,
esbuild 0.28.2, Yahoo Finance 4.0.6 and Orval 8.47.0, plus patched
transitive dependencies. Updating Orval removed the installed vulnerable
TypeDoc/minimatch, Markdown-It and brace-expansion dependency chains.

The latest Tailwind Typography release still requests a vulnerable 6.0.x
postcss-selector-parser, so a parent-scoped override selects patched 6.1.x.
The one-day minimum package release age remains enabled.

## Verification

- `pnpm audit --json`: before, 1 critical, 23 high, 27 moderate, 5 low;
  after, no known vulnerabilities.
- `pnpm --filter @workspace/api-server test`: 234 passed, 0 failed,
  1 skipped out of 235. The skipped test requires an explicitly enabled
  disposable PostgreSQL database.
- `pnpm --filter @workspace/screener test`: 111 passed, 0 failed.
- `pnpm run typecheck`: passed across the workspace.
- `pnpm run build:production`: frontend and API builds passed.
- `git diff --check`: passed.
- Restarted the three existing development workflows successfully.
- Preview `/api/healthz`: HTTP 200; unauthenticated `/api/sessions`: HTTP 401.
- The mobile 402×874 screenshot rendered the existing signed-out login page
  without visible layout errors or browser runtime errors.

## Limits

The screenshot was not an authenticated dashboard test. No live trading,
Telegram delivery, external-source freshness or production deployment was
validated by this dependency update. The existing large frontend bundle warning
remains non-blocking. An audit with no known findings is not a guarantee that
software has no security defects.

No publication was initiated. The already-running development API was restarted;
its existing startup migration check and scheduler resumed normally. No new
migration or background job was added.
