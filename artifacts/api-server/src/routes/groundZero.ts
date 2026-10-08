import { Router } from "express";
import { desc } from "drizzle-orm";
import { db, groundZeroSnapshotsTable } from "@workspace/db";
import { CreateGroundZeroSnapshotBody } from "@workspace/api-zod";
import { GROUND_ZERO, groundZeroSnapshot, validateGroundZeroInput } from "../lib/groundZero";
import { stockholmSignalDate } from "../lib/signalDatePolicy";

const router = Router();
async function state() {
  const rows = await db.select().from(groundZeroSnapshotsTable)
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
export default router;
