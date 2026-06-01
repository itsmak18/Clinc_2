import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validateParamInt } from "../lib/validators";
import { getDoctorAnalytics, listDoctorAnalytics } from "../services/analytics.service";

const router = Router();
router.use(requireAuth);

router.get(
  "/analytics/doctors",
  asyncHandler(async (req: AuthRequest, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    res.json(await listDoctorAnalytics(req, { dateFrom, dateTo }));
  }),
);

router.get(
  "/analytics/doctors/:doctorId",
  validateParamInt("doctorId"),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = parseInt(req.params.doctorId as string);
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    res.json(await getDoctorAnalytics(req, doctorId, { dateFrom, dateTo }));
  }),
);

export default router;
