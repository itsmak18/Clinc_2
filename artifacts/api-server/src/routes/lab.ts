import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { safeParseInt } from "../lib/validators";
import { listLabTests, createLabTest, getLabTest, updateLabTest } from "../services/lab.service";

const router = Router();
router.use(requireAuth);
router.use("/lab", requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"));

router.get("/lab/tests", asyncHandler(async (req: AuthRequest, res) => {
  const { status, patientId, limit, offset } = req.query as Record<string, string | undefined>;
  res.json(await listLabTests(req, { status, patientId, limit, offset }));
}));

router.post("/lab/tests",
  requireRole("super_admin", "admin", "doctor", "lab_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createLabTest(req, req.body));
  }),
);

router.get("/lab/tests/:testId",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const testId = safeParseInt(req.params.testId);
    if (!testId) { res.status(400).json({ error: "Invalid test ID" }); return; }
    res.json(await getLabTest(req, testId));
  }),
);

router.patch("/lab/tests/:testId",
  requireRole("super_admin", "admin", "lab_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const testId = safeParseInt(req.params.testId);
    if (!testId) { res.status(400).json({ error: "Invalid test ID" }); return; }
    res.json(await updateLabTest(req, testId, req.body));
  }),
);

export default router;
