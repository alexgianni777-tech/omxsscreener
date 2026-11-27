import { Router, type IRouter } from "express";
import { getOmxs30DailyCoverage } from "../lib/omxs30DataCoverage";
import { isE2ETestMode } from "../lib/e2eTestSafety";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/omxs30/coverage", async (_req, res): Promise<void> => {
  if (isE2ETestMode()) {
    res.status(503).json({ error: "Yahoo D−1-kontroll är avstängd i E2E-läge för att undvika externa anrop." });
    return;
  }
  try {
    const report = await getOmxs30DailyCoverage();
    res.setHeader("Cache-Control", "private, no-store");
    logger.info({
      decisionDate: report.decisionDate,
      expectedDataAsOf: report.expectedDataAsOf,
      validMembers: report.validMemberCount,
      expectedMembers: report.expectedMemberCount,
      indexStatus: report.index.status,
      reportStatus: report.status,
    }, "OMXS30 D−1 coverage checked");
    res.json(report);
  } catch (error) {
    logger.error({ err: error }, "OMXS30 D−1 coverage request failed");
    res.status(502).json({ error: "OMXS30 D−1-kontrollen kunde inte slutföras; ingen äldre kurs används som reserv." });
  }
});

export default router;
