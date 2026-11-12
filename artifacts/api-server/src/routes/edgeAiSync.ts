import { Router } from "express";
import { validImportBearer } from "../lib/importBearer";
import type { EdgeAiCheckResult } from "../lib/scheduler";

/** Machine endpoint, like telegram-import: same existing bearer, no user session.
 * Accepts no report/date/payload override and only checks the latest valid report.
 */
export function createEdgeAiSyncRouter(
  check: () => Promise<EdgeAiCheckResult>,
  secret: () => string | undefined = () => process.env.TELEGRAM_IMPORT_SECRET,
) {
  const router = Router();
  router.post("/edgeai-sync", async (req, res) => {
    const configured = secret();
    if (!configured) {
      res.status(503).json({ error: "Import authentication not configured" });
      return;
    }
    if (!validImportBearer(req.headers.authorization, configured)) {
      res.status(401).json({ error: "Invalid or missing bearer token" });
      return;
    }
    try {
      const result = await check();
      res.status(result.status === "FAILED" ? 503 : 200).json(result);
    } catch {
      res.status(503).json({ error: "EdgeAI check failed; see administrator diagnostics" });
    }
  });
  return router;
}
