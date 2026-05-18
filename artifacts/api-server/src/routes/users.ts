import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { authGate } from "../middlewares/auth-gate";
import { asyncHandler } from "../middlewares/asyncHandler";
import { safeParseInt } from "../lib/validators";
import {
  listUsers, listOnShiftUsers, listDoctors, getUser,
  createUser, updateUser, toggleShift, deleteUser, resetPassword,
} from "../services/users.service";

const router = Router();
router.use(requireAuth);

router.get(
  "/users",
  requireRole("super_admin", "admin", "front_desk", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { role, isActive } = req.query as Record<string, string | undefined>;
    res.json(await listUsers(req, { role, isActive }));
  }),
);

router.get(
  "/users/on-shift",
  requireRole("super_admin", "admin", "front_desk", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await listOnShiftUsers(req));
  }),
);

router.get(
  "/users/doctors",
  requireRole("super_admin", "admin", "front_desk", "nurse", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await listDoctors(req));
  }),
);

router.post(
  "/users",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await createUser(req, req.body);
    res.status(201).json(user);
  }),
);

router.get(
  "/users/:userId",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = safeParseInt(req.params.userId);
    if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }
    res.json(await getUser(req, userId));
  }),
);

router.patch(
  "/users/:userId",
  authGate("privileged", ["super_admin", "admin"]),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = safeParseInt(req.params.userId);
    if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }
    res.json(await updateUser(req, userId, req.body));
  }),
);

router.post(
  "/users/:userId/toggle-shift",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = safeParseInt(req.params.userId);
    if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }
    res.json(await toggleShift(req, userId));
  }),
);

router.delete(
  "/users/:userId",
  authGate("privileged", ["super_admin", "admin"]),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = safeParseInt(req.params.userId);
    if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }
    await deleteUser(req, userId);
    res.json({ success: true });
  }),
);

router.post(
  "/users/:userId/reset-password",
  authGate("privileged", ["super_admin", "admin"]),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = safeParseInt(req.params.userId);
    if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }
    await resetPassword(req, userId, req.body.newPassword);
    res.json({ success: true });
  }),
);

export default router;
