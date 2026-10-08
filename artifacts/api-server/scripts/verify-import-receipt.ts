import assert from "node:assert/strict";
import { db, screenerSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { synchronizeCandidates } from "../src/lib/candidateSynchronization";
import { makeImportReport } from "../src/lib/importReport";

// Development verification only. Every test write is deliberately rolled back.
const rollback = new Error("Intentional verification rollback");
async function main() {
  let verified = false;
  try {
    await db.transaction(async tx => {
      const date = "1904-01-04";
      const [session] = await tx.insert(screenerSessionsTable).values({
        date, source: "edgeai", omxsValue: 100, perf5d: 0, perf1m: 0, perf3m: 0,
        marketRsi: 50, trendLabel: "TEST", rawText: "RECEIPT_ROLLBACK_TEST",
      }).returning();
      const input = {
        market: "SE", signalSource: "edgeai", signalDate: date, ticker: "TEST-IMPORT.ST",
        category: "MOMENTUM", direction: "LONG", price: 100, entryPrice: 100, stopPrice: 95,
        targetPrice: 110, rr: 2, oneR: 5, rsi: 55, volMultiplier: 2, rank: 1,
        rs3m: 2, perf1m: 2, pctB: 0.95, atr: 3, distFrom20dH: 1,
      };
      const report = makeImportReport("edgeai", date, { candidates: [input] }, null, { SE: date, US: null });
      const testClock = new Date("1904-01-04T09:00:00Z");
      const first = await synchronizeCandidates(tx, session.id, [input], testClock, report);
      const second = await synchronizeCandidates(tx, session.id, [input], testClock, report);
      assert.equal(first.candidates.length, 1);
      assert.equal(first.candidates[0].ticker, "TEST-IMPORT");
      assert.equal(second.duplicateReport, true);
      assert.deepEqual(second.candidates.map(c => c.id), first.candidates.map(c => c.id));
      assert.deepEqual(second.diff, { added: [], updated: [], removed: [] });
      const [stored] = await tx.select().from(screenerSessionsTable).where(eq(screenerSessionsTable.id, session.id));
      assert.ok(Array.isArray(stored.sourceReports));
      assert.equal(stored.sourceReports.length, 1);
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(verified, true);
  const remains = await db.select().from(screenerSessionsTable).where(eq(screenerSessionsTable.date, "1904-01-04"));
  assert.equal(remains.length, 0);
  console.log("PASS: same source report twice => one normalized candidate, one receipt, no duplicate writes; all test data rolled back.");
}
main().then(() => process.exit(0), error => {
  console.error("Receipt transaction verification failed:", {
    name: error?.name, code: error?.cause?.code ?? error?.code,
    column: error?.cause?.column, constraint: error?.cause?.constraint,
  });
  process.exit(1);
});
