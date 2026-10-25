import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import screenerRouter from "./screener";
import candidatesRouter from "./candidates";
import dashboardRouter from "./dashboard";
import quotesRouter from "./quotes";
import edgeaiRouter from "./edgeai";
import survivalRouter from "./survival";
import newsRouter from "./news";
import analyticsRouter from "./analytics";
import earningsScreenerRouter from "./earningsScreener";
import priceChartRouter from "./priceChart";
import telegramImportRouter from "./telegramImport";
import marketIntelRouter from "./marketIntel";
import portfolioRouter from "./portfolio";
import journalRouter from "./journal";
import groundZeroRouter from "./groundZero";
import unusedCandidatesRouter from "./unusedCandidates";
import { ImportDataError } from "../lib/importReport";
import { recordImportFailure } from "../lib/importFailure";
import { isAcceptedSignalDate, stockholmSignalDate } from "../lib/signalDatePolicy";
import { requireAdministrator, requireAuthentication } from "../middlewares/authMiddleware";
import { checkEdgeAiAfterWake } from "../lib/scheduler";
import { createEdgeAiSyncRouter } from "./edgeAiSync";
import { createImportWakeMiddleware } from "../middlewares/importWake";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(telegramImportRouter); // unauthenticated — uses its own bearer-token check
router.use(createEdgeAiSyncRouter(checkEdgeAiAfterWake));
router.use(requireAuthentication);
router.use(requireAdministrator);
// Public health probes and rejected users cannot start a wake check.
router.use(createImportWakeMiddleware(checkEdgeAiAfterWake));
router.use(groundZeroRouter);
router.use(unusedCandidatesRouter);
router.use(screenerRouter);
router.use(candidatesRouter);
router.use(dashboardRouter);
router.use(quotesRouter);
router.use(edgeaiRouter);
router.use(survivalRouter);
router.use(newsRouter);
router.use(analyticsRouter);
router.use(earningsScreenerRouter);
router.use(priceChartRouter);
router.use(marketIntelRouter);
router.use(portfolioRouter);
router.use(journalRouter);
router.use(async (error: unknown, req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof ImportDataError) {
    if (error.report) {
      const today = stockholmSignalDate();
      const date = req.body?.targetDate ?? (isAcceptedSignalDate(error.report.signalDate, today) ? today : error.report.signalDate);
      try { await recordImportFailure(date, error.report, error.message); } catch { /* Keep the original error visible even if diagnostic storage fails. */ }
    }
    res.status(422).json({ error: error.message }); return;
  }
  next(error);
});

export default router;
