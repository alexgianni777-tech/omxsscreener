import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  DELETE_UNUSED_CANDIDATES_SQL, developmentCleanupEnabled, UNUSED_CANDIDATE_RETENTION_DAYS,
} from "../lib/unusedCandidates";

const router = Router();
router.delete("/candidates/unused", async (_req, res) => {
  if (!developmentCleanupEnabled(process.env.NODE_ENV)) {
    res.status(403).json({ error: "Rensning är endast aktiverad i utvecklingsmiljön. Produktionshistoriken är skyddad." });
    return;
  }
  const deletedCount = await db.transaction(async tx => {
    await tx.execute(sql.raw(`LOCK TABLE screener_sessions, candidates,
      top3_selection_snapshots, top3_selection_revisions, trade_journal,
      survival_trades, open_positions IN SHARE ROW EXCLUSIVE MODE`));
    const deleted = await tx.execute(sql.raw(DELETE_UNUSED_CANDIDATES_SQL));
    return deleted.rows.length;
  });
  res.json({ deletedCount, retentionDays: UNUSED_CANDIDATE_RETENTION_DAYS });
});
export default router;
