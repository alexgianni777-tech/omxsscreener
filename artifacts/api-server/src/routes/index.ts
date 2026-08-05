import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenerRouter from "./screener";
import candidatesRouter from "./candidates";
import dashboardRouter from "./dashboard";
import quotesRouter from "./quotes";
import edgeaiRouter from "./edgeai";
import survivalRouter from "./survival";
import newsRouter from "./news";

const router: IRouter = Router();

router.use(healthRouter);
router.use(screenerRouter);
router.use(candidatesRouter);
router.use(dashboardRouter);
router.use(quotesRouter);
router.use(edgeaiRouter);
router.use(survivalRouter);
router.use(newsRouter);

export default router;
