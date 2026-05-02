import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, verifyPassword } from "../lib/auth";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      fullNameAr: user.fullNameAr,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    },
  });
});

router.post("/auth/logout", requireAuth, (_req, res) => {
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    fullNameAr: user.fullNameAr,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
});

export default router;
