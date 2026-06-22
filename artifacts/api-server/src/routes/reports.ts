import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { appointmentsSummary, revenueSummary, diagnosticsSummary, operationsSummary } from "../services/reports.service";

const router = Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate optional dateFrom/dateTo query params: must be YYYY-MM-DD and, when
 * both present, ordered. Invalid input fails fast with the canonical 400 envelope
 * instead of degrading to a NaN-bounded query in the service.
 */
function parseRange(req: AuthRequest): { dateFrom?: string; dateTo?: string } {
  const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
  for (const [name, val] of [["dateFrom", dateFrom], ["dateTo", dateTo]] as const) {
    if (val !== undefined && (typeof val !== "string" || !DATE_RE.test(val) || isNaN(Date.parse(val)))) {
      throw new ValidationError(`Invalid ${name}: expected YYYY-MM-DD`);
    }
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ValidationError("dateFrom must be on or before dateTo");
  }
  return { dateFrom, dateTo };
}

// Appointment operations report — admins + doctors (doctors are scoped to their
// own appointments inside the service).
router.get(
  "/reports/appointments",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await appointmentsSummary(req, parseRange(req)));
  }),
);

// Revenue report — clinic-wide financials. Restricted to financial/admin roles;
// doctors no longer see whole-clinic revenue or peer billing (least privilege).
router.get(
  "/reports/revenue",
  requireRole("super_admin", "admin", "billing_manager"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await revenueSummary(req, parseRange(req)));
  }),
);

// Lab / X-ray / Ultrasound diagnostics report — doctors are patient-scoped via doctor_scope RLS.
router.get(
  "/reports/diagnostics",
  requireRole("super_admin", "admin", "doctor", "billing_manager"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await diagnosticsSummary(req, parseRange(req)));
  }),
);

// Operations report — per-surgeon volume + OR-team participation. Clinic-wide
// operational analytics (includes non-clinical staff), so admin-only.
router.get(
  "/reports/operations",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await operationsSummary(req, parseRange(req)));
  }),
);

export default router;
