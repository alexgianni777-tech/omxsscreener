import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Handle idle-client errors (e.g. "terminating connection due to administrator command").
// Without this handler, Node.js treats the emitted 'error' event as uncaught and crashes
// the entire process. The pool reconnects automatically — we just need to swallow the event.
pool.on("error", (err) => {
  console.error("[db-pool] idle client error (non-fatal, pool will reconnect):", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
