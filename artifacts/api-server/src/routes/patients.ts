import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
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
    const { search, limit, offset } = req.query as Record<string, string | undefined>;
    res.json(await listPatients(req, { search, limit, offset }));
  }),
);

router.post("/patients",
  requireRole("super_admin", "admin", "nurse", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patient = await createPatient(req, req.body);
    res.status(201).json(patient);
  }),
);

router.get("/patients/:patientId",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }
    res.json(await getPatient(req, patientId));
  }),
);

router.patch("/patients/:patientId",
  requireRole("super_admin", "admin", "nurse", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }
    res.json(await updatePatient(req, patientId, req.body));
  }),
);

router.delete("/patients/:patientId",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }
    await deletePatient(req, patientId);
    res.json({ success: true });
  }),
);

router.get("/patients/:patientId/summary",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }
    res.json(await getPatientSummary(req, patientId));
  }),
);

export default router;
