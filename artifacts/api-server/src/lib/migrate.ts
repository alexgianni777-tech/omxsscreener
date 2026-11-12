import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "./logger";

// __dirname is injected by the esbuild banner in the built output.
// Built file: <repo_root>/artifacts/api-server/dist/index.mjs
// __dirname : <repo_root>/artifacts/api-server/dist
// migrations: <repo_root>/lib/db/migrations
declare const __dirname: string;

// Arbitrary stable integer used as the PostgreSQL advisory lock key.
// This ensures that when multiple API-server instances start concurrently
// (autoscale deployments), only one runs DDL at a time; the others wait.
const MIGRATION_ADVISORY_LOCK_ID = 7_241_283_649n; // bigint fits pg_advisory_lock

/**
 * Apply all pending Drizzle migrations to the database, then return.
 *
 * Safety properties:
 *  - Uses versioned SQL files (lib/db/migrations/), not `push --force`.
 *    Every schema change is an explicit, reviewable, committed SQL file.
 *  - Serialised via a PostgreSQL session-level advisory lock: concurrent
 *    startup instances queue here and skip if already applied.
 *  - Uses a dedicated one-shot pg.Client so the lock is released the moment
 *    this function returns (client.end() releases the session lock).
 *  - Throws on failure — the caller (main()) owns process termination.
 */
export async function runMigrations(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    logger.warn("DATABASE_URL not set — skipping migrations");
    return;
  }

  // Migrations are copied into dist/ alongside the bundle during the build
  // step (see build.mjs), so the deployable artifact is self-contained.
  // __dirname === <artifact>/dist at runtime (injected by esbuild banner).
  const migrationsFolder = path.resolve(__dirname, "./migrations");

  // Dedicated client — not the shared pool — so we control lifecycle and the
  // advisory lock is released automatically when we call client.end().
  const client = new pg.Client({
    connectionString: process.env["DATABASE_URL"],
  });

  await client.connect();

  try {
    // pg_advisory_lock(bigint) blocks until the lock is available.
    // When multiple instances start at once, they serialise here rather than
    // issuing concurrent DDL. After the first instance migrates and disconnects,
    // the second acquires the lock, finds nothing pending, and continues.
    logger.info("Acquiring migration advisory lock");
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      MIGRATION_ADVISORY_LOCK_ID.toString(),
    ]);

    logger.info({ migrationsFolder }, "Applying pending migrations");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    logger.info("Migrations complete — schema is up to date");
  } finally {
    // client.end() closes the connection and automatically releases all
    // session-level advisory locks held by this client.
    await client.end().catch((e: unknown) => {
      logger.warn({ err: e }, "Error closing migration client (non-fatal)");
    });
  }
}
