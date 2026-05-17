import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { getDashboardSummary, getDepartmentLoad, getRecentActivity } from "../services/dashboard.service";

const router = Router();
router.use(requireAuth);

router.get("/dashboard/summary", asyncHandler(async (_req, res) => {
  res.json(await getDashboardSummary());
}));

router.get("/dashboard/department-load", requireRole("super_admin", "admin"), asyncHandler(async (_req, res) => {
  res.json(await getDepartmentLoad());
}));

router.get("/dashboard/recent-activity", asyncHandler(async (_req, res) => {
  res.json(await getRecentActivity());
}));

export default router;
