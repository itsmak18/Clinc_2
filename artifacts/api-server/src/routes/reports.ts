import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { appointmentsSummary, revenueSummary } from "../services/reports.service";

const router = Router();
router.use(requireAuth);
router.use("/reports", requireRole("super_admin", "admin", "doctor"));

router.get(
  "/reports/appointments",
  asyncHandler(async (req: AuthRequest, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    res.json(await appointmentsSummary(req, { dateFrom, dateTo }));
  }),
);

router.get(
  "/reports/revenue",
  asyncHandler(async (req: AuthRequest, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    res.json(await revenueSummary(req, { dateFrom, dateTo }));
  }),
);

export default router;
