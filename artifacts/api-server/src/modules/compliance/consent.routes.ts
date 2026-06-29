import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { ValidationError } from "../../services/errors";
import { safeParseInt } from "../../lib/validators";
import { listConsents, grantConsent, revokeConsent } from "./consent.service";

const router = Router();
router.use(requireAuth);

router.get("/patients/:patientId/consents",
  requireRole("super_admin", "admin", "compliance_officer", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patientId");
    const { cursor, limit } = req.query as Record<string, string | undefined>;
    res.json(await listConsents(req, patientId, { cursor, limit }));
  }),
);

router.post("/patients/:patientId/consents",
  requireRole("super_admin", "admin", "nurse", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patientId");
    res.status(201).json(await grantConsent(req, patientId, req.body));
  }),
);

router.delete("/patients/:patientId/consents/:consentId",
  requireRole("super_admin", "admin", "compliance_officer"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    const consentId = safeParseInt(req.params.consentId);
    if (!patientId || !consentId) throw new ValidationError("Invalid ID");
    res.json(await revokeConsent(req, patientId, consentId));
  }),
);

export default router;
