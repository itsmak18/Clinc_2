import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validateParamInt } from "../lib/validators";
import { getDoctorAnalytics, listDoctorAnalytics } from "../services/analytics.service";

const router = Router();
router.use(requireAuth);

// Defense-in-depth (F-P7-2 follow-up): gate roles at the route layer, not only in
// the service. The service still enforces the finer rule (a doctor may view only
// their own analytics — analytics.service.ts:290-294).
router.get(
  "/analytics/doctors",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    res.json(await listDoctorAnalytics(req, { dateFrom, dateTo }));
  }),
);

router.get(
  "/analytics/doctors/:doctorId",
  requireRole("super_admin", "admin", "doctor"),
  validateParamInt("doctorId"),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = parseInt(req.params.doctorId as string);
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    res.json(await getDoctorAnalytics(req, doctorId, { dateFrom, dateTo }));
  }),
);

export default router;
