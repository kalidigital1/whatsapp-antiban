import { Router, type IRouter } from "express";
import authRouter, { requireAuth } from "./auth";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import whatsappRouter from "./whatsapp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use((req, res, next) => {
  if (
    req.path === "/webhook"
    || req.path === "/evolution/webhook"
    || req.path.startsWith("/evolution/webhook/")
  ) {
    next();
    return;
  }
  requireAuth(req, res, next);
});
router.use(dashboardRouter);
router.use(whatsappRouter);

export default router;
