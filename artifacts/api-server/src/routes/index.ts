import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenerRouter from "./screener";
import candidatesRouter from "./candidates";
import dashboardRouter from "./dashboard";
import quotesRouter from "./quotes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(screenerRouter);
router.use(candidatesRouter);
router.use(dashboardRouter);
router.use(quotesRouter);

export default router;
