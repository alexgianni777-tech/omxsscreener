import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { candidatesTable, screenerSessionsTable } from "@workspace/db";
import { prepareE2ETestMode } from "./e2eTestSafety";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { makeImportReport } from "./importReport";
import { synchronizeCandidates } from "./candidateSynchronization";

test("isolated PostgreSQL: additive migration, quality JSON roundtrip, idempotence and recorded history", {
  skip: process.env.ASF_ISOLATED_DB_TEST !== "1",
}, async () => {
  const url = "postgresql://asf_e2e@127.0.0.1:55432/asf_e2e_quality";
  prepareE2ETestMode({ E2E_TEST: "1", NODE_ENV: "development", DATABASE_URL: url });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../../lib/db/migrations", import.meta.url)) });
    await client.query("BEGIN");
    const [session] = await db.insert(screenerSessionsTable).values({
      date: "2026-11-04", omxsValue: 100, perf5d: 0, perf1m: 0, perf3m: 0,
      marketRsi: 50, trendLabel: "DEMO", rawText: "DEMO – isolated quality test", source: "edgeai",
    }).returning();
    const mapped = mapEdgeAiSetup({
      ticker: "DEMO", dir: "LONG", setup: "Momentum", entry: 100, stop: 95, target: 110,
      signalT: "2026-11-03T10:00:00Z", barsAgo: 0, rs: 1, evidenceStatus: "WATCH",
      eliteStatus: "RESEARCH_ONLY", eliteQualified: false, validatedEdge: false,
      edge: { winRate: 50, expectancyR: 0.1, sample: 20 },
    }, "SE", {}, "2026-11-03");
    const [recorded] = await db.insert(candidatesTable).values({
      ...mapped, sessionId: session.id, signalSource: "edgeai", outcome: "WIN",
      exitPrice: 110, realizedR: 2,
    }).returning();
    assert.equal(recorded.dataQuality?.eliteQualified, false);
    assert.equal(recorded.dataQuality?.eliteStatus, "RESEARCH_ONLY");
    assert.equal(recorded.dataQuality?.dataAsOf, "2026-11-03");
    const incoming = [{ ...mapped, signalSource: "edgeai", stopPrice: 94 }];
    const report = makeImportReport("edgeai", "2026-11-04", incoming);
    const now = new Date("2026-11-04T12:00:00Z");
    await synchronizeCandidates(db, session.id, incoming, now, report);
    const duplicate = await synchronizeCandidates(db, session.id, incoming, now, report);
    assert.equal(duplicate.duplicateReport, true);
    const [after] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, recorded.id));
    assert.equal(after.stopPrice, 95);
    assert.equal(after.outcome, "WIN");
    assert.equal(after.realizedR, 2);
    assert.deepEqual(after.dataQuality, recorded.dataQuality);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});
