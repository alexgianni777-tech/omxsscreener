import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenerRouter from "./screener";
import candidatesRouter from "./candidates";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(screenerRouter);
router.use(candidatesRouter);
router.use(dashboardRouter);

export default router;
