import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listMedicalRecords, createMedicalRecord, getMedicalRecord,
  updateMedicalRecord, setGlobalFlag,
} from "../services/medical-records.service";

const router = Router();
router.use(requireAuth);

router.get("/medical-records",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { patientId, doctorId } = req.query as Record<string, string | undefined>;
    res.json(await listMedicalRecords(req, { patientId, doctorId }));
  }),
);

router.post("/medical-records",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createMedicalRecord(req, req.body));
  }),
);

router.get("/medical-records/:recordId",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const recordId = safeParseInt(req.params.recordId);
    if (!recordId) throw new ValidationError("Invalid record ID");
    const record = await getMedicalRecord(req, recordId);
    res.json(record);
  }),
);

router.patch("/medical-records/:recordId",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const recordId = safeParseInt(req.params.recordId);
    if (!recordId) throw new ValidationError("Invalid record ID");
    const record = await updateMedicalRecord(req, recordId, req.body);
    res.json(record);
  }),
);

router.patch("/medical-records/:recordId/global-flag",
  requireRole("super_admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const recordId = safeParseInt(req.params.recordId);
    if (!recordId) throw new ValidationError("Invalid record ID");
    res.json(await setGlobalFlag(req, recordId, req.body));
  }),
);

export default router;
