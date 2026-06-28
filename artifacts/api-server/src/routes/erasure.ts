import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listErasureRequests, createErasureRequest,
  reviewErasureRequest, executeErasure,
} from "../services/erasure.service";

const router = Router();
router.use(requireAuth);

router.get("/erasure-requests",
  requireRole("super_admin", "admin", "compliance_officer"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { cursor, limit } = req.query as Record<string, string | undefined>;
    res.json(await listErasureRequests(req, { cursor, limit }));
  }),
);

router.post("/erasure-requests",
  requireRole("super_admin", "admin", "compliance_officer"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createErasureRequest(req, req.body));
  }),
);

// Approve or reject a pending request
router.post("/erasure-requests/:id/review",
  requireRole("super_admin", "compliance_officer"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.id);
    if (!id) throw new ValidationError("Invalid request ID");
    res.json(await reviewErasureRequest(req, id, req.body));
  }),
);

// Execute an approved request (super_admin only — irreversible)
router.post("/erasure-requests/:id/execute",
  requireRole("super_admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.id);
    if (!id) throw new ValidationError("Invalid request ID");
    res.json(await executeErasure(req, id));
  }),
);

export default router;
