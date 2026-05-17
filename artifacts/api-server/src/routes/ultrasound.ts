import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { safeParseInt } from "../lib/validators";
import { listUltrasounds, createUltrasound, getUltrasound, updateUltrasound } from "../services/ultrasound.service";

const router = Router();
router.use(requireAuth);
router.use("/ultrasound", requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"));

router.get("/ultrasound", asyncHandler(async (req: AuthRequest, res) => {
  const { status, patientId, limit, offset } = req.query as Record<string, string | undefined>;
  res.json(await listUltrasounds(req, { status, patientId, limit, offset }));
}));

router.post("/ultrasound", asyncHandler(async (req: AuthRequest, res) => {
  res.status(201).json(await createUltrasound(req, req.body));
}));

router.get("/ultrasound/:ultrasoundId",
  requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) { res.status(400).json({ error: "Invalid ultrasound ID" }); return; }
    res.json(await getUltrasound(req, id));
  }),
);

router.patch("/ultrasound/:ultrasoundId",
  requireRole("super_admin", "admin", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) { res.status(400).json({ error: "Invalid ultrasound ID" }); return; }
    res.json(await updateUltrasound(req, id, req.body));
  }),
);

export default router;
