import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { hashPassword, validatePasswordStrength } from "../lib/auth";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();

router.use(requireAuth);

const userSelect = {
  id:        usersTable.id,
  username:  usersTable.username,
  fullName:  usersTable.fullName,
  fullNameAr:usersTable.fullNameAr,
  email:     usersTable.email,
  role:      usersTable.role,
  phone:     usersTable.phone,
  isActive:  usersTable.isActive,
  isOnShift: usersTable.isOnShift,
  createdAt: usersTable.createdAt,
};

router.get("/users", async (req: AuthRequest, res) => {
  const { role, isActive } = req.query;
  let users = await db.select(userSelect).from(usersTable).where(isNull(usersTable.deletedAt));
  if (role)       users = users.filter(u => u.role === role);
  if (isActive !== undefined) users = users.filter(u => u.isActive === (isActive === "true"));
  res.json(users);
});

// On-shift users for Front Desk routing
router.get("/users/on-shift", async (_req, res) => {
  const users = await db.select(userSelect).from(usersTable)
    .where(and(isNull(usersTable.deletedAt), eq(usersTable.isOnShift, true)));
  res.json(users);
});

router.post("/users", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { username, password, fullName, fullNameAr, email, role, phone } = req.body;
  if (!username || !password || !fullName || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // Enforce password complexity on creation
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const { hash } = hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    username, passwordHash: hash, fullName, fullNameAr, email, role, phone,
  }).returning();
  await logAudit(req, "CREATE", "user", user.id);
  res.status(201).json({ ...user, passwordHash: undefined });
});

router.get("/users/:userId", async (req, res) => {
  const [user] = await db.select(userSelect).from(usersTable)
    .where(eq(usersTable.id, parseInt(req.params.userId as string)));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(user);
});

router.patch("/users/:userId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { fullName, fullNameAr, email, role, phone, isActive, isOnShift } = req.body;
  const before = await db.select(userSelect).from(usersTable)
    .where(eq(usersTable.id, parseInt(req.params.userId as string)));
  const [user] = await db.update(usersTable)
    .set({ fullName, fullNameAr, email, role, phone, isActive, isOnShift, updatedAt: new Date() })
    .where(eq(usersTable.id, parseInt(req.params.userId as string)))
    .returning();
  await logAudit(req, "UPDATE", "user", user.id, { before: before[0], after: user });
  res.json(user);
});

// Toggle on-shift for a specific user (admin only)
router.post("/users/:userId/toggle-shift", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const userId = parseInt(req.params.userId as string);
  const [current] = await db.select({ isOnShift: usersTable.isOnShift }).from(usersTable).where(eq(usersTable.id, userId));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const [user] = await db.update(usersTable)
    .set({ isOnShift: !current.isOnShift, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  await logAudit(req, "TOGGLE_SHIFT", "user", userId, { isOnShift: user.isOnShift });
  res.json(user);
});

router.delete("/users/:userId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const [user] = await db.update(usersTable)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, parseInt(req.params.userId as string)))
    .returning();
  await logAudit(req, "DELETE", "user", user.id);
  res.json({ success: true });
});

router.post("/users/:userId/reset-password", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { newPassword } = req.body;
  if (!newPassword) {
    res.status(400).json({ error: "New password required" });
    return;
  }

  // Enforce password complexity on reset
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const { hash } = hashPassword(newPassword);
  await db.update(usersTable)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(usersTable.id, parseInt(req.params.userId as string)));
  await logAudit(req, "RESET_PASSWORD", "user", parseInt(req.params.userId as string));
  res.json({ success: true });
});

export default router;
