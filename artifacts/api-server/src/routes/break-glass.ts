import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  activateBreakGlass, revokeBreakGlass, listBreakGlassSessions,
} from "../services/break-glass.service";

const router = Router();
router.use(requireAuth);

// Activate a break-glass session for a patient (any authenticated role)
router.post("/break-glass/patients/:patientId/activate",
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patientId");
    res.status(201).json(await activateBreakGlass(req, patientId, req.body));
  }),
);

// Revoke a break-glass session (owner, compliance_officer, admin, super_admin)
router.post("/break-glass/sessions/:sessionId/revoke",
  asyncHandler(async (req: AuthRequest, res) => {
    const sessionId = safeParseInt(req.params.sessionId);
    if (!sessionId) throw new ValidationError("Invalid sessionId");
    res.json(await revokeBreakGlass(req, sessionId));
  }),
);

// List break-glass sessions (compliance_officer, admin, super_admin only)
router.get("/break-glass/sessions",
  requireRole("super_admin", "admin", "compliance_officer"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { patientId, active } = req.query as Record<string, string | undefined>;
    res.json(await listBreakGlassSessions(req, { patientId, active }));
  }),
);

export default router;
