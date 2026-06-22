import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validate } from "../middlewares/validate";
import { CreatePatientBody, UpdatePatientBody } from "@workspace/api-zod";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listPatients, createPatient, getPatient, updatePatient,
  deletePatient, getPatientSummary,
} from "../services/patients.service";

const router = Router();
router.use(requireAuth);

router.get("/patients",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { search, limit, cursor } = req.query as Record<string, string | undefined>;
    res.json(await listPatients(req, { search, limit, cursor }));
  }),
);

router.post("/patients",
  // Registration is an intake duty (front desk / admin), not a clinical one.
  // Nurses keep read + edit; they do not create patients.
  requireRole("super_admin", "admin", "front_desk"),
  validate(CreatePatientBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const patient = await createPatient(req, req.body);
    res.status(201).json(patient);
  }),
);

router.get("/patients/:patientId",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patient ID");
    res.json(await getPatient(req, patientId));
  }),
);

router.patch("/patients/:patientId",
  // Demographic edits are an intake duty (front desk / admin). Nurse removed
  // 2026-06-21 alongside contact-PII redaction — a role that can't see
  // address/phone must not be able to blank them through the edit form.
  requireRole("super_admin", "admin", "front_desk"),
  validate(UpdatePatientBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patient ID");
    res.json(await updatePatient(req, patientId, req.body));
  }),
);

router.delete("/patients/:patientId",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patient ID");
    await deletePatient(req, patientId);
    res.json({ success: true });
  }),
);

router.get("/patients/:patientId/summary",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patient ID");
    res.json(await getPatientSummary(req, patientId));
  }),
);

export default router;
