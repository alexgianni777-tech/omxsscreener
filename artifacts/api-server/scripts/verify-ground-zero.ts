import assert from "node:assert/strict";
import { db, groundZeroSnapshotsTable, screenerSessionsTable, candidatesTable, survivalTradesTable, tradeJournalTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { GROUND_ZERO, groundZeroSnapshot, validateGroundZeroInput } from "../src/lib/groundZero";

// Only development DB. All manual-valuation fixture writes are rolled back.
const rollback = new Error("Ground Zero verification rollback");
async function counts(tx: any) {
  const tables = [screenerSessionsTable, candidatesTable, survivalTradesTable, tradeJournalTable, groundZeroSnapshotsTable];
  const result = [];
  for (const table of tables) result.push((await tx.select({ n: count() }).from(table))[0].n);
  return result;
}
async function main() {
  let checked = false;
  try {
    await db.transaction(async tx => {
      const before = await counts(tx);
      const original = validateGroundZeroInput({ asOfDate: GROUND_ZERO.baseDate, totalValueSek: 16736.60, netExternalFlowsSek: 0 }, "2026-10-08");
      const [first] = await tx.insert(groundZeroSnapshotsTable).values(original).returning();
      const [deposit] = await tx.insert(groundZeroSnapshotsTable).values({ ...original, totalValueOre: original.totalValueOre + 100000, netExternalFlowsOre: 100000 }).returning();
      const [withdrawal] = await tx.insert(groundZeroSnapshotsTable).values({ ...original, totalValueOre: original.totalValueOre - 100000, netExternalFlowsOre: -100000 }).returning();
      const [unknown] = await tx.insert(groundZeroSnapshotsTable).values({ ...original, netExternalFlowsOre: null }).returning();
      const [reloaded] = await tx.select().from(groundZeroSnapshotsTable).where(eq(groundZeroSnapshotsTable.id, deposit.id));
      assert.equal(groundZeroSnapshot(first).adjustedChangeSek, 0);
      assert.equal(groundZeroSnapshot(reloaded).adjustedChangeSek, 0);
      assert.equal(groundZeroSnapshot(withdrawal).adjustedChangeSek, 0);
      assert.equal(groundZeroSnapshot(unknown).adjustedChangeSek, null);
      const after = await counts(tx);
      assert.deepEqual(after.slice(0, 4), before.slice(0, 4));
      assert.equal(after[4], before[4] + 4);
      checked = true;
      throw rollback;
    });
  } catch (err) { if (err !== rollback) throw err; }
  assert.ok(checked);
  console.log("PASS: exact cents persist/reload; deposit/withdrawal excluded; unknown flows stay unknown; existing history counts unchanged; all fixtures rolled back.");
  process.exit(0);
}
main().catch(err => { console.error("Verification failed:", err.name, err.code ?? "", err.column ?? ""); process.exit(1); });
