import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { validate } from "../../middlewares/validate";
import { CreatePrescriptionBody } from "@workspace/api-zod";
import { ValidationError } from "../../services/errors";
import { safeParseInt } from "../../lib/validators";
import {
  listPrescriptions,
  createPrescription,
  getPrescription,
  dispensePrescription,
  voidPrescription,
  sendPrescriptionToPharmacy,
} from "./prescriptions.service";

const router = Router();
router.use(requireAuth);

// ── Read: nurses, lab staff, and pharmacists can also read prescriptions ──
// Pharmacist's landing route is /prescriptions (getLandingRoute) — denying
// them GET access means login → immediate 403. Caught by route-access drift test.
router.get(
  "/prescriptions",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff", "pharmacist"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { patientId, limit, cursor } = req.query as Record<string, string | undefined>;
    const result = await listPrescriptions(req, { patientId, limit, cursor });
    res.json(result.data);
  }),
);

// ── Create: ONLY doctors and admins ───────────────────────────────────────
router.post(
  "/prescriptions",
  requireRole("super_admin", "admin", "doctor"),
  validate(CreatePrescriptionBody),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createPrescription(req, req.body));
  }),
);

// ── Read single ──────────────────────────────────────────────────────────
router.get(
  "/prescriptions/:prescriptionId",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff", "pharmacist"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.prescriptionId);
    if (!id) throw new ValidationError("Invalid prescription ID");
    res.json(await getPrescription(req, id));
  }),
);

// ── Dispense: pharmacist marks prescription as dispensed ─────────────────
router.post(
  "/prescriptions/:prescriptionId/dispense",
  requireRole("super_admin", "admin", "pharmacist"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.prescriptionId);
    if (!id) throw new ValidationError("Invalid prescription ID");
    res.json(await dispensePrescription(req, id));
  }),
);

// ── Send to pharmacy: notify clinic pharmacists (doctors/admins) ──────────
router.post(
  "/prescriptions/:prescriptionId/send-to-pharmacy",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.prescriptionId);
    if (!id) throw new ValidationError("Invalid prescription ID");
    res.json(await sendPrescriptionToPharmacy(req, id));
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
