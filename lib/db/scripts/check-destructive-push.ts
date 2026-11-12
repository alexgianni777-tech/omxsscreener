/**
 * Pre-push safety gate for `drizzle-kit push` in production.
 *
 * `drizzle-kit push` compares the schema in code against the LIVE database
 * and applies whatever it takes to reconcile them — including resolving an
 * ambiguous rename as "create the new column, drop the old one" (silent data
 * loss) or altering a column's type in a way that can fail or corrupt data.
 * Interactive `push` normally asks the operator to confirm those cases, but
 * the production deploy runs non-interactively (no TTY), so there is nobody
 * to answer the prompt.
 *
 * This script runs BEFORE `drizzle-kit push` in the deploy command. It
 * introspects the live database and compares it against the Drizzle schema
 * in code. If it finds a column or table that exists in the live database
 * but not in the current schema (a `push` would drop it) or a column whose
 * live type is incompatible with the schema's expected type, it fails loudly
 * instead of letting `push` silently resolve the ambiguity.
 *
 * Escape hatch: for an intentional column/table removal (the final step of
 * the safe 3-step rename documented in SCHEMA-SAFETY.md), set
 * ALLOW_SCHEMA_DATA_LOSS=true for that one deploy.
 */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "../src/schema";

type LiveColumn = { name: string; dataType: string; udtName: string };

// Conservative map of Drizzle/postgres column kinds we use to the Postgres
// data_type values that are safe matches. Anything not listed here is left
// unchecked for type mismatches (we only ever WARN, never block, on a kind
// we don't recognize — false positives that block a healthy deploy are worse
// than missing an exotic case).
const COMPATIBLE_TYPES: Record<string, string[]> = {
  serial: ["integer"],
  integer: ["integer"],
  real: ["real", "double precision", "numeric"],
  text: ["text", "character varying"],
  boolean: ["boolean"],
  timestamp: ["timestamp with time zone", "timestamp without time zone"],
  date: ["date"],
  jsonb: ["jsonb"],
  varchar: ["character varying", "text"],
};

async function main() {
  if (process.env.ALLOW_SCHEMA_DATA_LOSS === "true") {
    console.warn(
      "[schema-safety] ALLOW_SCHEMA_DATA_LOSS=true — skipping the destructive-change check for this deploy.",
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run the schema safety check.");
  }

  // Each exported table has its own literal TableConfig type, so TypeScript can't unify
  // them under a single type predicate — filter with a plain boolean check and cast the
  // result, since `is()` already guarantees correctness at runtime.
  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as unknown as PgTable<any>[];
  if (tables.length === 0) {
    throw new Error("[schema-safety] No Drizzle tables found in schema — refusing to push blind. This likely means the schema import is broken.");
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: liveTables } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const liveTableNames = new Set(liveTables.map((t) => t.table_name));

    const expectedTableNames = new Set(tables.map((t) => getTableConfig(t).name));

    const droppedTables = [...liveTableNames].filter((name) => !expectedTableNames.has(name));

    const droppedColumnsByTable: Record<string, string[]> = {};
    const typeMismatchesByTable: Record<string, { column: string; liveType: string; expectedKind: string }[]> = {};

    for (const table of tables) {
      const config = getTableConfig(table);
      if (!liveTableNames.has(config.name)) continue; // brand-new table — nothing to lose

      const { rows: liveColumns } = await pool.query<LiveColumn>(
        `select column_name as name, data_type as "dataType", udt_name as "udtName"
         from information_schema.columns where table_schema = 'public' and table_name = $1`,
        [config.name],
      );
      const liveByName = new Map(liveColumns.map((c) => [c.name, c]));
      const expectedColumnNames = new Set(config.columns.map((c) => c.name));

      const dropped = [...liveByName.keys()].filter((name) => !expectedColumnNames.has(name));
      if (dropped.length > 0) droppedColumnsByTable[config.name] = dropped;

      for (const col of config.columns) {
        const live = liveByName.get(col.name);
        if (!live) continue; // new column — additive, safe
        // Drizzle's columnType is e.g. "PgReal", "PgTimestamp" — strip the "Pg" prefix
        // to match the lowercase keys in COMPATIBLE_TYPES.
        const kind = ((col as any).columnType ?? "").replace(/^Pg/, "").toLowerCase();
        const compatible = COMPATIBLE_TYPES[kind];
        if (!compatible) continue; // unrecognized kind — don't false-positive block
        if (!compatible.includes(live.dataType)) {
          (typeMismatchesByTable[config.name] ??= []).push({
            column: col.name,
            liveType: live.dataType,
            expectedKind: kind,
          });
        }
      }
    }

    const hasIssues =
      droppedTables.length > 0 ||
      Object.keys(droppedColumnsByTable).length > 0 ||
      Object.keys(typeMismatchesByTable).length > 0;

    if (!hasIssues) {
      console.log("[schema-safety] No destructive schema changes detected — proceeding with push.");
      return;
    }

    console.error("\n🛑 [schema-safety] Refusing to run `drizzle-kit push` — it would apply a destructive change:\n");
    if (droppedTables.length > 0) {
      console.error(`  Tables that would be DROPPED (present in DB, missing from schema):`);
      for (const t of droppedTables) console.error(`    - ${t}`);
    }
    for (const [table, cols] of Object.entries(droppedColumnsByTable)) {
      console.error(`  Columns that would be DROPPED from "${table}" (present in DB, missing from schema):`);
      for (const c of cols) console.error(`    - ${c}`);
    }
    for (const [table, mismatches] of Object.entries(typeMismatchesByTable)) {
      console.error(`  Columns in "${table}" whose live type looks incompatible with the schema:`);
      for (const m of mismatches) console.error(`    - ${m.column}: live type "${m.liveType}", schema expects "${m.expectedKind}"`);
    }
    console.error(
      "\nThis usually means a column/table was renamed or its type changed in code. `drizzle-kit push`\n" +
      "cannot ask for confirmation in this non-interactive deploy, so it would resolve the ambiguity\n" +
      "on its own — which can silently delete data.\n\n" +
      "See lib/db/SCHEMA-SAFETY.md for the safe 3-step rename process.\n" +
      "If this removal is intentional (e.g. step 3 of that process), redeploy with\n" +
      "ALLOW_SCHEMA_DATA_LOSS=true set for this one deploy.\n",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[schema-safety] Check failed to run:", err);
  process.exitCode = 1;
});
