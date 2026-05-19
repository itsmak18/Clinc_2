import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import { listXrays, createXray, getXray, updateXray } from "../services/xray.service";

const router = Router();
router.use(requireAuth);
router.use("/xray", requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"));

router.get("/xray", asyncHandler(async (req: AuthRequest, res) => {
  const { status, patientId, limit, offset } = req.query as Record<string, string | undefined>;
  res.json(await listXrays(req, { status, patientId, limit, offset }));
}));

router.post("/xray", asyncHandler(async (req: AuthRequest, res) => {
  res.status(201).json(await createXray(req, req.body));
}));

router.get("/xray/:xrayId",
  requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) throw new ValidationError("Invalid xray ID");
    res.json(await getXray(req, xrayId));
  }),
);

router.patch("/xray/:xrayId",
  requireRole("super_admin", "admin", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) throw new ValidationError("Invalid xray ID");
    res.json(await updateXray(req, xrayId, req.body));
  }),
);

export default router;
