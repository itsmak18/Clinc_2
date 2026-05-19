import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listPrescriptions,
  createPrescription,
  getPrescription,
  voidPrescription,
} from "../services/prescriptions.service";

const router = Router();
router.use(requireAuth);

// ── Read: nurses and lab staff can also read prescriptions ────────────────
router.get(
  "/prescriptions",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { patientId, limit, offset } = req.query as Record<string, string | undefined>;
    res.json(await listPrescriptions(req, { patientId, limit, offset }));
  }),
);

// ── Create: ONLY doctors and admins ───────────────────────────────────────
router.post(
  "/prescriptions",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createPrescription(req, req.body));
  }),
);

// ── Read single ──────────────────────────────────────────────────────────
router.get(
  "/prescriptions/:prescriptionId",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.prescriptionId);
    if (!id) throw new ValidationError("Invalid prescription ID");
    res.json(await getPrescription(req, id));
  }),
);

// ── Prescriptions are IMMUTABLE medical documents ─────────────────────────
// No PATCH endpoint. Admins can soft-delete with a reason for corrections.
router.delete(
  "/prescriptions/:prescriptionId",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.prescriptionId);
    if (!id) throw new ValidationError("Invalid prescription ID");
    await voidPrescription(req, id, req.body?.reason);
    res.json({ success: true });
  }),
);

export default router;
