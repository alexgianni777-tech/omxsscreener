import { Router, type IRouter } from "express";
import { db, candidatesTable, tradeJournalTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { CreateJournalRecordBody } from "@workspace/api-zod";
import { journalInputKey, journalMetrics, type JournalRecord } from "../lib/tradeJournal";

type Payload = Omit<JournalRecord, "id" | "createdAt">;
type Row = { id: string; payload: unknown; createdAt: Date };
export interface JournalStore {
  list(): Promise<Row[]>;
  find(id: string): Promise<Row | undefined>;
  candidate(id: number): Promise<typeof candidatesTable.$inferSelect | undefined>;
  insert(id: string, payload: Payload): Promise<Row>;
}
const store: JournalStore = {
  list: () => db.select().from(tradeJournalTable).orderBy(desc(tradeJournalTable.createdAt)),
  find: async (id) => (await db.select().from(tradeJournalTable).where(eq(tradeJournalTable.id, id)))[0],
  candidate: async (id) => (await db.select().from(candidatesTable).where(eq(candidatesTable.id, id)))[0],
  insert: async (id, payload) => {
    const [inserted] = await db.insert(tradeJournalTable).values({ id, payload }).onConflictDoNothing().returning();
    if (inserted) return inserted;
    const existing = await store.find(id);
    if (!existing) throw new Error("Journal record could not be read after insert");
    return existing;
  },
};
function response(row: Row): JournalRecord {
  return { ...(row.payload as Payload), id: row.id, createdAt: row.createdAt.toISOString() };
}

/** Mounted after both authentication and administrator guards; never mutates source tables. */
export function journalRouter(storage: JournalStore = store): IRouter {
  const router = Router();
  router.get("/journal", async (_req, res) => {
    res.json((await storage.list()).map(response));
  });
  router.post("/journal", async (req, res) => {
    const parsed = CreateJournalRecordBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Ogiltig journaldata.", details: parsed.error.issues }); return; }
    const input = parsed.data;
    let metrics;
    try { metrics = journalMetrics(input); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const key = journalInputKey(input);
    const previous = await storage.find(input.id);
    if (previous) {
      if (journalInputKey((previous.payload as Payload).input) !== key) {
        res.status(409).json({ error: "Journal-ID används redan för andra uppgifter. Den sparade historiken har inte ändrats." }); return;
      }
      res.status(201).json(response(previous)); return;
    }
    const candidate = await storage.candidate(input.candidateId);
    if (!candidate) { res.status(404).json({ error: "Källsignalen finns inte längre. Välj en befintlig signal." }); return; }
    const payload: Payload = {
      input, metrics,
      signal: {
        ticker: candidate.ticker, source: candidate.signalSource, signalDate: candidate.signalDate,
        dataDate: candidate.volumeAsOf, bucket: candidate.category, direction: candidate.direction,
        sessionId: candidate.sessionId, entryPrice: candidate.entryPrice, stopPrice: candidate.stopPrice,
        targetPrice: candidate.targetPrice, rr: candidate.rr,
      },
    };
    const saved = await storage.insert(input.id, payload);
    if (journalInputKey((saved.payload as Payload).input) !== key) {
      res.status(409).json({ error: "Samtidiga journalanrop hade olika uppgifter. Originalet är bevarat." }); return;
    }
    res.status(201).json(response(saved));
  });
  return router;
}
export default journalRouter();
