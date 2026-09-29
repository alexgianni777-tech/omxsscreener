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
import { requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// Legacy GitHub Action uses bearer-secret machine auth instead of a browser session.
router.use(telegramImportRouter);

// Everything below is private application data/actions.
router.use(requireAuth);

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

export default router;
