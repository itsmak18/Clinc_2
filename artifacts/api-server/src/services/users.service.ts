import { db } from "@workspace/db";
import { usersTable, appointmentsTable } from "@workspace/db";
import { eq, isNull, and, gte, lte } from "drizzle-orm";
import { todayBoundary } from "../lib/dateUtils";
import { hashPassword, validatePasswordStrength } from "../lib/password";
import { revokeAllTokensForUser } from "../lib/auth";
import { logAudit, logRead } from "../lib/audit";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

const VALID_SPECIALTIES = [
  "general_practice", "dentistry", "cardiology", "dermatology",
  "pediatrics", "orthopedics", "ultrasound", "xray", "neurology",
  "gynecology", "ophthalmology", "psychiatry",
] as const;

export const userSelect = {
  id:         usersTable.id,
  username:   usersTable.username,
  fullName:   usersTable.fullName,
  fullNameAr: usersTable.fullNameAr,
  email:      usersTable.email,
  role:       usersTable.role,
  phone:      usersTable.phone,
  specialty:  usersTable.specialty,
  department: usersTable.department,
  isActive:   usersTable.isActive,
  isOnShift:  usersTable.isOnShift,
  createdAt:  usersTable.createdAt,
};

export async function listUsers(
  req: AuthRequest,
  params: { role?: string; isActive?: string },
) {
  const conditions: any[] = [isNull(usersTable.deletedAt)];
  if (params.role) conditions.push(eq(usersTable.role, params.role as any));
  if (params.isActive !== undefined) conditions.push(eq(usersTable.isActive, params.isActive === "true"));
  return db.select(userSelect).from(usersTable).where(and(...conditions));
}

export async function listOnShiftUsers(req: AuthRequest) {
  return db
    .select(userSelect)
    .from(usersTable)
    .where(and(isNull(usersTable.deletedAt), eq(usersTable.isOnShift, true)));
}

export async function listDoctors(req: AuthRequest) {
  return db
    .select({
      id:         usersTable.id,
      fullName:   usersTable.fullName,
      fullNameAr: usersTable.fullNameAr,
      specialty:  usersTable.specialty,
    })
    .from(usersTable)
    .where(and(eq(usersTable.role, "doctor"), eq(usersTable.isActive, true), isNull(usersTable.deletedAt)));
}

export async function getUser(req: AuthRequest, userId: number) {
  const [user] = await db.select(userSelect).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new NotFoundError("User not found");
  void logRead(req, "user", userId);
  return user;
}

export async function createUser(
  req: AuthRequest,
  body: {
    username?: string;
    password?: string;
    fullName?: string;
    fullNameAr?: string;
    email?: string;
    role?: string;
    phone?: string;
    specialty?: string;
    department?: string;
  },
) {
  const { username, password, fullName, fullNameAr, email, role, phone, specialty, department } = body;
  if (!username || !password || !fullName || !role) {
    throw new ValidationError("Missing required fields: username, password, fullName, role");
  }

  if (role === "super_admin" && req.user!.role !== "super_admin") {
    void logAudit(req, "ESCALATION_DENIED", "user", undefined, { attemptedRole: role });
    throw new ForbiddenError("Only super admins can create super admin users");
  }

  if (specialty && !VALID_SPECIALTIES.includes(specialty as any)) {
    throw new ValidationError(`Invalid specialty. Valid values: ${VALID_SPECIALTIES.join(", ")}`);
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) throw new ValidationError(strength.reason!);

  const hash = await hashPassword(password);
  const [user] = await db
    .insert(usersTable)
    .values({ username, passwordHash: hash, fullName, fullNameAr, email, role: role as any, phone, specialty, department })
    .returning();

  void logAudit(req, "CREATE", "user", user.id);
  return { ...user, passwordHash: undefined };
}

export async function updateUser(
  req: AuthRequest,
  userId: number,
  body: {
    fullName?: string;
    fullNameAr?: string;
    email?: string;
    role?: string;
    phone?: string;
    isActive?: boolean;
    isOnShift?: boolean;
    specialty?: string;
    department?: string;
  },
) {
  if (userId === req.user!.userId) {
    throw new ForbiddenError("Employees cannot edit their own profile. Please contact an administrator.");
  }

  const { fullName, fullNameAr, email, role, phone, isActive, isOnShift, specialty, department } = body;

  if (role === "super_admin" && req.user!.role !== "super_admin") {
    void logAudit(req, "ESCALATION_DENIED", "user", userId, { attemptedRole: role });
    throw new ForbiddenError("Only super admins can promote users to super admin");
  }

  if (specialty && !VALID_SPECIALTIES.includes(specialty as any)) {
    throw new ValidationError(`Invalid specialty. Valid values: ${VALID_SPECIALTIES.join(", ")}`);
  }

  const [before] = await db.select(userSelect).from(usersTable).where(eq(usersTable.id, userId));
  const [user] = await db
    .update(usersTable)
    .set({ fullName, fullNameAr, email, role: role as any, phone, isActive, isOnShift, specialty, department, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();

  if (!user) throw new NotFoundError("User not found");

  if (before && before.role !== role) {
    await revokeAllTokensForUser(userId);
  }

  void logAudit(req, "UPDATE", "user", user.id, { before, after: user });
  return user;
}

export async function toggleShift(req: AuthRequest, userId: number) {
  const [current] = await db
    .select({ isOnShift: usersTable.isOnShift, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!current) throw new NotFoundError("User not found");

  const newShiftState = !current.isOnShift;
  const [user] = await db
    .update(usersTable)
    .set({ isOnShift: newShiftState, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();

  void logAudit(req, "TOGGLE_SHIFT", "user", userId, { isOnShift: user.isOnShift });

  let shiftSummary: Record<string, number> | undefined;
  if (!newShiftState && current.role === "doctor") {
    const { start, end } = todayBoundary();
    const appointments = await db
      .select({ status: appointmentsTable.status })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.doctorId, userId), gte(appointmentsTable.scheduledAt, start), lte(appointmentsTable.scheduledAt, end)));

    shiftSummary = {
      total: appointments.length,
      completed: appointments.filter((a) => a.status === "completed").length,
      cancelled: appointments.filter((a) => a.status === "cancelled").length,
      remaining: appointments.filter((a) => !["completed", "cancelled", "no_show"].includes(a.status)).length,
    };
  }

  return shiftSummary ? { ...user, shiftSummary } : user;
}

export async function deleteUser(req: AuthRequest, userId: number) {
  if (userId === req.user!.userId) {
    throw new ForbiddenError("You cannot delete your own account");
  }

  const [user] = await db
    .update(usersTable)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();

  if (!user) throw new NotFoundError("User not found");
  void logAudit(req, "DELETE", "user", user.id);
}

export async function resetPassword(req: AuthRequest, userId: number, newPassword: string) {
  if (!newPassword) throw new ValidationError("New password required");

  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) throw new ValidationError(strength.reason!);

  const hash = await hashPassword(newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  void logAudit(req, "RESET_PASSWORD", "user", userId);
}
