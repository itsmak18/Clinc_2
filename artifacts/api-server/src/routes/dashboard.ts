import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { getDashboardSummary, getDepartmentLoad, getRecentActivity, getFrontDeskDashboard, getNurseDashboard, getPharmacistDashboard, getBillingDashboard, getComplianceDashboard, getImagingDashboard, getLabDashboard } from "../services/dashboard.service";

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

router.get("/dashboard/front-desk", requireRole("super_admin", "admin", "front_desk"), asyncHandler(async (_req, res) => {
  res.json(await getFrontDeskDashboard());
}));

router.get("/dashboard/nurse", requireRole("super_admin", "admin", "nurse"), asyncHandler(async (_req, res) => {
  res.json(await getNurseDashboard());
}));

router.get("/dashboard/pharmacy", requireRole("super_admin", "admin", "pharmacist"), asyncHandler(async (_req, res) => {
  res.json(await getPharmacistDashboard());
}));

router.get("/dashboard/billing", requireRole("super_admin", "admin", "billing_manager"), asyncHandler(async (_req, res) => {
  res.json(await getBillingDashboard());
}));

router.get("/dashboard/compliance", requireRole("super_admin", "compliance_officer"), asyncHandler(async (_req, res) => {
  res.json(await getComplianceDashboard());
}));

router.get("/dashboard/imaging", requireRole("super_admin", "admin", "xray_staff"), asyncHandler(async (_req, res) => {
  res.json(await getImagingDashboard());
}));

router.get("/dashboard/lab", requireRole("super_admin", "admin", "lab_staff"), asyncHandler(async (_req, res) => {
  res.json(await getLabDashboard());
}));

export default router;
