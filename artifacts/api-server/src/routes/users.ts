import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, appointmentsTable } from "@workspace/db";
import { eq, isNull, and, gte, lte } from "drizzle-orm";
import { todayBoundary } from "../lib/dateUtils";
import { hashPassword, validatePasswordStrength } from "../lib/password";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { safeParseInt } from "../lib/validators";

const router = Router();

router.use(requireAuth);

const VALID_SPECIALTIES = [
  "general_practice", "dentistry", "cardiology", "dermatology",
  "pediatrics", "orthopedics", "ultrasound", "xray", "neurology",
  "gynecology", "ophthalmology", "psychiatry",
] as const;

const userSelect = {
  id:         usersTable.id,
  username:   usersTable.username,
  fullName:   usersTable.fullName,
  fullNameAr: usersTable.fullNameAr,
  email:      usersTable.email,
  role:       usersTable.role,
  phone:      usersTable.phone,
  specialty:  usersTable.specialty,   // N-06
  department: usersTable.department,  // N-06
  isActive:   usersTable.isActive,
  isOnShift:  usersTable.isOnShift,
  createdAt:  usersTable.createdAt,
};

router.get("/users", requireRole("super_admin", "admin", "front_desk", "nurse"), async (req: AuthRequest, res) => {
  const { role, isActive } = req.query;
  const conditions: any[] = [isNull(usersTable.deletedAt)];
  if (role) conditions.push(eq(usersTable.role, role as any));
  if (isActive !== undefined) conditions.push(eq(usersTable.isActive, isActive === "true"));
  const users = await db.select(userSelect).from(usersTable).where(and(...conditions));
  res.json(users);
});

// On-shift users for Front Desk routing
router.get("/users/on-shift", requireRole("super_admin", "admin", "front_desk", "nurse"), async (_req, res) => {
  const users = await db.select(userSelect).from(usersTable)
    .where(and(isNull(usersTable.deletedAt), eq(usersTable.isOnShift, true)));
  res.json(users);
});

router.get("/users/doctors",
  requireRole("super_admin", "admin", "front_desk", "nurse", "doctor"),
  async (_req, res) => {
    const doctors = await db.select({
      id:         usersTable.id,
      fullName:   usersTable.fullName,
      fullNameAr: usersTable.fullNameAr,
      specialty:  usersTable.specialty,  // N-06: include for appointment booking
    }).from(usersTable)
      .where(and(eq(usersTable.role, "doctor"), eq(usersTable.isActive, true), isNull(usersTable.deletedAt)));
    res.json(doctors);
  }
);

router.post("/users", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { username, password, fullName, fullNameAr, email, role, phone, specialty, department } = req.body;
  if (!username || !password || !fullName || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // ── Role escalation prevention ──────────────────────────────────────────
  // Only super_admin can create super_admin users
  if (role === "super_admin" && req.user!.role !== "super_admin") {
    await logAudit(req, "ESCALATION_DENIED", "user", undefined, { attemptedRole: role });
    res.status(403).json({ error: "Only super admins can create super admin users" });
    return;
  }

  // N-06: Validate specialty for doctor role
  if (specialty && !VALID_SPECIALTIES.includes(specialty)) {
    res.status(400).json({ error: "Invalid specialty", validValues: [...VALID_SPECIALTIES] });
    return;
  }

  // Enforce password complexity on creation
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const hash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    username, passwordHash: hash, fullName, fullNameAr, email, role, phone, specialty, department,
  }).returning();
  await logAudit(req, "CREATE", "user", user.id);
  res.status(201).json({ ...user, passwordHash: undefined });
});

router.get("/users/:userId", requireRole("super_admin", "admin"), async (req, res) => {
  const userId = safeParseInt(req.params.userId);
  if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }
  const [user] = await db.select(userSelect).from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(user);
});

router.patch("/users/:userId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const userId = safeParseInt(req.params.userId);
  if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { fullName, fullNameAr, email, role, phone, isActive, isOnShift, specialty, department } = req.body;

  // ── Self-modification prevention (Strict Mode) ─────────────────────────
  if (userId === req.user!.userId) {
    res.status(403).json({ error: "Employees cannot edit their own profile. Please contact an administrator." });
    return;
  }

  // ── Role escalation prevention ──────────────────────────────────────────
  if (role === "super_admin" && req.user!.role !== "super_admin") {
    await logAudit(req, "ESCALATION_DENIED", "user", userId, { attemptedRole: role });
    res.status(403).json({ error: "Only super admins can promote users to super admin" });
    return;
  }

  // N-06: Validate specialty
  if (specialty && !VALID_SPECIALTIES.includes(specialty)) {
    res.status(400).json({ error: "Invalid specialty", validValues: [...VALID_SPECIALTIES] });
    return;
  }

  const before = await db.select(userSelect).from(usersTable).where(eq(usersTable.id, userId));
  const [user] = await db.update(usersTable)
    .set({ fullName, fullNameAr, email, role, phone, isActive, isOnShift, specialty, department, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
    
  if (before[0] && before[0].role !== role) {
    const { revokeAllTokensForUser } = await import("../lib/auth");
    await revokeAllTokensForUser(userId);
  }

  await logAudit(req, "UPDATE", "user", user.id, { before: before[0], after: user });
  res.json(user);
});

// Toggle on-shift for a specific user (admin only)
router.post("/users/:userId/toggle-shift", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const userId = safeParseInt(req.params.userId);
  if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }
  const [current] = await db.select({ isOnShift: usersTable.isOnShift, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const newShiftState = !current.isOnShift;
  const [user] = await db.update(usersTable)
    .set({ isOnShift: newShiftState, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  await logAudit(req, "TOGGLE_SHIFT", "user", userId, { isOnShift: user.isOnShift });

  // Generate shift handover report if a doctor is clocking out
  if (!newShiftState && current.role === "doctor") {
    const { start, end } = todayBoundary();
    const appointments = await db.select({ status: appointmentsTable.status })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.doctorId, userId),
          gte(appointmentsTable.scheduledAt, start),
          lte(appointmentsTable.scheduledAt, end)
        )
      );

    const summary = {
      total: appointments.length,
      completed: appointments.filter(a => a.status === "completed").length,
      cancelled: appointments.filter(a => a.status === "cancelled").length,
      remaining: appointments.filter(a => !["completed", "cancelled", "no_show"].includes(a.status)).length,
    };
    
    res.json({ ...user, shiftSummary: summary });
    return;
  }

  res.json(user);
});

router.delete("/users/:userId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const userId = safeParseInt(req.params.userId);
  if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }

  // Cannot delete yourself
  if (userId === req.user!.userId) {
    res.status(403).json({ error: "You cannot delete your own account" });
    return;
  }

  const [user] = await db.update(usersTable)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  await logAudit(req, "DELETE", "user", user.id);
  res.json({ success: true });
});

router.post("/users/:userId/reset-password", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const userId = safeParseInt(req.params.userId);
  if (!userId) { res.status(400).json({ error: "Invalid user ID" }); return; }

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

  const hash = await hashPassword(newPassword);
  await db.update(usersTable)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  await logAudit(req, "RESET_PASSWORD", "user", userId);
  res.json({ success: true });
});

export default router;
