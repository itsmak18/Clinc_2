import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validate } from "../middlewares/validate";
import { CreateVitalsBody } from "@workspace/api-zod";
import { createVitals, listVitals } from "../services/vitals.service";

const router = Router();
router.use(requireAuth);

router.get("/vitals",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { patientId, appointmentId } = req.query as Record<string, string | undefined>;
    res.json(await listVitals(req, { patientId, appointmentId }));
  }),
);

router.post("/vitals",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  validate(CreateVitalsBody),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createVitals(req, req.body));
  }),
);

export default router;
