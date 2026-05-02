import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();

router.use(requireAuth);

router.get("/users", async (req: AuthRequest, res) => {
  const { role } = req.query;
  let users = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    fullName: usersTable.fullName,
    fullNameAr: usersTable.fullNameAr,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(isNull(usersTable.deletedAt));
  if (role) users = users.filter(u => u.role === role);
  res.json(users);
});

router.post("/users", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { username, password, fullName, fullNameAr, email, role, phone } = req.body;
  if (!username || !password || !fullName || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const { hash } = hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    username, passwordHash: hash, fullName, fullNameAr, email, role, phone,
  }).returning();
  await logAudit(req, "CREATE", "user", user.id);
  res.status(201).json(user);
});

router.get("/users/:userId", async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parseInt(req.params.userId)));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(user);
});

router.patch("/users/:userId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { fullName, fullNameAr, email, role, phone, isActive } = req.body;
  const [user] = await db.update(usersTable)
    .set({ fullName, fullNameAr, email, role, phone, isActive, updatedAt: new Date() })
    .where(eq(usersTable.id, parseInt(req.params.userId)))
    .returning();
  await logAudit(req, "UPDATE", "user", user.id);
  res.json(user);
});

router.delete("/users/:userId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const [user] = await db.update(usersTable)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, parseInt(req.params.userId)))
    .returning();
  await logAudit(req, "DELETE", "user", user.id);
  res.json({ success: true });
});

router.post("/users/:userId/reset-password", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { newPassword } = req.body;
  if (!newPassword) { res.status(400).json({ error: "New password required" }); return; }
  const { hash } = hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(usersTable.id, parseInt(req.params.userId)));
  await logAudit(req, "UPDATE", "user_password", parseInt(req.params.userId));
  res.json({ success: true });
});

export default router;
