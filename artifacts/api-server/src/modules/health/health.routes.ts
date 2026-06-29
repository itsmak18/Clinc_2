import { Router, type IRouter } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { checkReadiness } from "./health.service";

const router: IRouter = Router();

const startedAt = new Date().toISOString();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

router.get(
  "/healthz/ready",
  asyncHandler(async (_req, res) => {
    const { ok, checks } = await checkReadiness();
    res.status(ok ? 200 : 503).json({
      status: ok ? "ready" : "not_ready",
      checks: { ...checks, process: { ...(checks.process as Record<string, unknown>), startedAt } },
      timestamp: new Date().toISOString(),
    });
  }),
);

export default router;
