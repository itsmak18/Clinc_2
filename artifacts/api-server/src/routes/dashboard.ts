import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { getDashboardSummary, getDepartmentLoad, getRecentActivity, getFrontDeskDashboard, getNurseDashboard, getPharmacistDashboard, getBillingDashboard, getComplianceDashboard, getImagingDashboard, getLabDashboard } from "../services/dashboard.service";

const router = Router();
router.use(requireAuth);

router.get("/dashboard/summary", asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getDashboardSummary(req));
}));

router.get("/dashboard/department-load", requireRole("super_admin", "admin"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getDepartmentLoad(req));
}));

router.get("/dashboard/recent-activity", asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getRecentActivity(req));
}));

router.get("/dashboard/front-desk", requireRole("super_admin", "admin", "front_desk"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getFrontDeskDashboard(req));
}));

router.get("/dashboard/nurse", requireRole("super_admin", "admin", "nurse"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getNurseDashboard(req));
}));

router.get("/dashboard/pharmacy", requireRole("super_admin", "admin", "pharmacist"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getPharmacistDashboard(req));
}));

router.get("/dashboard/billing", requireRole("super_admin", "admin", "billing_manager"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getBillingDashboard(req));
}));

router.get("/dashboard/compliance", requireRole("super_admin", "compliance_officer"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getComplianceDashboard(req));
}));

router.get("/dashboard/imaging", requireRole("super_admin", "admin", "xray_staff"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getImagingDashboard(req));
}));

router.get("/dashboard/lab", requireRole("super_admin", "admin", "lab_staff"), asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getLabDashboard(req));
}));

export default router;
