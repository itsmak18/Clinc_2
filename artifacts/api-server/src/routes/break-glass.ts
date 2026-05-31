import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  activateBreakGlass, approveBreakGlass, revokeBreakGlass, listBreakGlassSessions,
} from "../services/break-glass.service";

const router = Router();
router.use(requireAuth);

// Activate a break-glass session for a patient.
// Restricted to clinical roles that could plausibly need emergency PHI access.
// Receptionist, billing, lab/xray techs, pharmacist must request access through
// normal authorization, not break-glass.
router.post("/break-glass/patients/:patientId/activate",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) throw new ValidationError("Invalid patientId");
    res.status(201).json(await activateBreakGlass(req, patientId, req.body));
  }),
);

// Revoke a break-glass session (owner, compliance_officer, admin, super_admin).
// When a compliance officer revokes an UNAPPROVED session, the audit action is
// BREAK_GLASS_DENIED — the explicit "deny" action in the approval workflow.
router.post("/break-glass/sessions/:sessionId/revoke",
  asyncHandler(async (req: AuthRequest, res) => {
    const sessionId = safeParseInt(req.params.sessionId);
    if (!sessionId) throw new ValidationError("Invalid sessionId");
    res.json(await revokeBreakGlass(req, sessionId));
  }),
);

// Phase 3.4: compliance approval gate. Until a session is approved it is valid
// only during the 5-minute grace window. compliance_officer / admin / super_admin
// roles can extend it to the full 15-minute TTL by calling this endpoint.
// Self-approval is forbidden in the service layer.
router.post("/break-glass/sessions/:sessionId/approve",
  requireRole("super_admin", "admin", "compliance_officer"),
  asyncHandler(async (req: AuthRequest, res) => {
    const sessionId = safeParseInt(req.params.sessionId);
    if (!sessionId) throw new ValidationError("Invalid sessionId");
    res.json(await approveBreakGlass(req, sessionId));
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
