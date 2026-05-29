import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listClinicNotices,
  createClinicNotice,
  deleteClinicNotice,
} from "../services/clinic-notices.service";

const router = Router();
router.use(requireAuth);

router.get(
  "/clinic-notices",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff", "ultrasound_staff", "pharmacist", "compliance_officer"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { limit, cursor } = req.query as Record<string, string | undefined>;
    res.json(await listClinicNotices(req, { limit, cursor }));
  }),
);

router.post(
  "/clinic-notices",
  requireRole("super_admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createClinicNotice(req, req.body));
  }),
);

router.delete(
  "/clinic-notices/:noticeId",
  requireRole("super_admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const noticeId = safeParseInt(req.params.noticeId);
    if (!noticeId) throw new ValidationError("Invalid notice ID");
    await deleteClinicNotice(req, noticeId);
    res.status(204).send();
  }),
);

export default router;
