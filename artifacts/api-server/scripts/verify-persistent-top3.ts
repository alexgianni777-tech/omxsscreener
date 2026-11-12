import assert from "node:assert/strict";
import { db, pool, screenerSessionsTable, top3SelectionRevisionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetLastValidTop3Response } from "@workspace/api-zod";
import { approveImportedTop3, readSavedTop3 } from "../src/lib/persistentTop3";
const rollback = new Error("rollback-only display verification");
async function main() {
  const baseline = await db.transaction(tx => readSavedTop3(tx), { isolationLevel: "repeatable read", accessMode: "read only" });
  console.log(`Existing baseline: ${baseline.selection?.date ?? "none"}; warnings: ${baseline.warnings.length}`);
  if (!baseline.selection) {
    console.log((await db.execute(sql`SELECT count(*) AS revisions, count(*) FILTER (WHERE available) AS complete,
      count(*) FILTER (WHERE display_eligible) AS approved FROM top3_selection_revisions`)).rows);
    console.log((await db.execute(sql`SELECT count(*) AS selected, count(*) FILTER (WHERE s.display_eligible) AS approved,
      count(*) FILTER (WHERE s.direction IS NULL) AS missing_direction,
      count(*) FILTER (WHERE c.entry_price IS NOT NULL AND c.stop_price IS NOT NULL AND c.target_price IS NOT NULL) AS plans
      FROM top3_selection_snapshots s LEFT JOIN candidates c ON c.id=s.candidate_id WHERE s.selected=true`)).rows);
  }
  let checked = false;
  try {
    await db.transaction(async tx => {
      const date = "1904-01-05", stamp = new Date(`${date}T10:00:00Z`);
      const report = { source: "edgeai", signalDate: date, fingerprint: "DISPLAY_ROLLBACK_TEST",
        status: "SUCCESS", importedAt: stamp.toISOString(), dataDates: { SE: "1904-01-04" } };
      const [s] = await tx.insert(screenerSessionsTable).values({
        date, source: "edgeai", omxsValue: 100, perf5d: 0, perf1m: 0, perf3m: 0,
        marketRsi: 50, trendLabel: "TEST", rawText: "DISPLAY_ROLLBACK_TEST", sourceReports: [report],
      }).returning();
      const input = { id: -1, ticker: "TEST-DISPLAY", category: "MOMENTUM", market: "SE", direction: "LONG",
        signalSource: "edgeai", signalDate: date, entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2 };
      const [v] = await tx.insert(top3SelectionRevisionsTable).values({
        sessionId: s.id, revision: 1, fingerprint: "DISPLAY_ROLLBACK_TEST", policyVersion: "official-top3-v7",
        available: true, displayEligible: false, sources: ["edgeai", "telegram"], inputs: [input],
        selections: [{ candidateId: -1, selected: true, rank: 1, score: 1, market: "SE",
          direction: "LONG", source: "edgeai", decision: { status: "TRADEABLE", reasons: [] } }],
        createdAt: stamp,
      }).returning();
      await approveImportedTop3(tx, s.id, { ...report, fingerprint: "old" });
      const [notApproved] = await tx.select().from(top3SelectionRevisionsTable).where(eq(top3SelectionRevisionsTable.id, v.id));
      assert.equal(notApproved.displayEligible, false);
      await approveImportedTop3(tx, s.id, report);
      const [approved] = await tx.select().from(top3SelectionRevisionsTable).where(eq(top3SelectionRevisionsTable.id, v.id));
      assert.equal(approved.displayEligible, true);
      assert.deepEqual(approved.inputs, v.inputs);
      assert.deepEqual(approved.selections, v.selections);
      const state = await readSavedTop3(tx);
      GetLastValidTop3Response.parse(state);
      assert.ok(state.selection);
      console.log(`Persisted display: ${state.selection.date} (${state.selection.kind}), ${state.selection.revision.picks.length} picks.`);
      checked = true;
      throw rollback;
    });
  } catch (e) { if (e !== rollback) throw e; }
  assert.ok(checked);
  const remaining = await db.select().from(screenerSessionsTable).where(eq(screenerSessionsTable.date, "1904-01-05"));
  assert.equal(remaining.length, 0);
  console.log("PASS: real DB atomic display approval; older replay rejected; snapshot JSON unchanged; selector reads persisted data; all fixtures rolled back.");
  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
