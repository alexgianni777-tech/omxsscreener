import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, groundZeroSnapshotsTable } from "@workspace/db";
import { CreateGroundZeroSnapshotBody } from "@workspace/api-zod";
import { GROUND_ZERO, groundZeroSnapshot, validateGroundZeroInput } from "../lib/groundZero";
import { stockholmSignalDate } from "../lib/signalDatePolicy";
import { createGroundZeroDeleteHandler } from "../lib/groundZeroDelete";

const router = Router();
async function state(reader: Pick<typeof db, "select"> = db) {
  const rows = await reader.select().from(groundZeroSnapshotsTable)
    .orderBy(desc(groundZeroSnapshotsTable.asOfDate), desc(groundZeroSnapshotsTable.id));
  const history = rows.map(groundZeroSnapshot);
  return { ...GROUND_ZERO, latest: history[0] ?? null, history };
}
router.get("/ground-zero", async (_req, res) => res.json(await state()));
router.post("/ground-zero", async (req, res) => {
  const parsed = CreateGroundZeroSnapshotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Ange datum, totalvärde och nettoflöde eller okända flöden." }); return; }
  let values;
  try { values = validateGroundZeroInput(parsed.data, stockholmSignalDate()); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }
  await db.insert(groundZeroSnapshotsTable).values(values);
  res.status(201).json(await state());
});
router.delete("/ground-zero/:id", createGroundZeroDeleteHandler(async id =>
  db.transaction(async tx => {
    const removed = await tx.delete(groundZeroSnapshotsTable)
      .where(eq(groundZeroSnapshotsTable.id, id)).returning({ id: groundZeroSnapshotsTable.id });
    return removed.length ? state(tx) : null;
  })
));
export default router;
