// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { usersTable, appointmentsTable } from "@workspace/db";
import { eq, isNull, and, gte, lte } from "drizzle-orm";
import { todayBoundary, getClinicTimezone } from "../../lib/dateUtils";
import { hashPassword, validatePasswordStrictAsync } from "../../lib/password";
import { revokeAllTokensForUser } from "../../lib/auth";
import { logAudit, logRead, auditSnapshot, changedFields } from "../../lib/audit";
import { NotFoundError, ForbiddenError, ValidationError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

const VALID_SPECIALTIES = [
  "general_practice", "dentistry", "cardiology", "dermatology",
  "pediatrics", "orthopedics", "ultrasound", "xray", "neurology",
  "gynecology", "ophthalmology", "psychiatry",
] as const;

/**
 * Authorization guard for acting ON an existing user (update / reset-password /
 * delete / toggle-shift). The route gate only restricts who may *call* these
 * endpoints (super_admin + admin) and the create/promote path separately blocks
 * minting a super_admin — but nothing stopped an `admin` from acting on an
 * existing `super_admin` (e.g. resetting their password and logging in as them,
 * F-1). super_admin is the system's top trust tier (it bypasses every role check
 * in the kernel), so only a super_admin may manage a super_admin.
 *
 * Pure + exported so the security decision is unit-tested directly, independent
 * of the DB-mocking needed for the service functions that consume it.
 */
export function canManageTarget(actorRole: string, targetRole: string): boolean {
  if (actorRole === "super_admin") return true;   // super_admin manages anyone
  if (targetRole === "super_admin") return false; // nobody below super_admin may touch a super_admin
  return true;                                     // admin manages all non-super_admin users
}

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
  addressLine: usersTable.addressLine,
  city:        usersTable.city,
  region:      usersTable.region,
  postalCode:  usersTable.postalCode,
  country:     usersTable.country,
  isActive:   usersTable.isActive,
  isOnShift:  usersTable.isOnShift,
  createdAt:  usersTable.createdAt,
};

export async function listUsers(
  req: AuthRequest,
  params: { role?: string; isActive?: string },
) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [isNull(usersTable.deletedAt), eq(usersTable.clinicId, req.user!.clinicId)];
    if (params.role) conditions.push(eq(usersTable.role, params.role as any));
    if (params.isActive !== undefined) conditions.push(eq(usersTable.isActive, params.isActive === "true"));
    return tx.select(userSelect).from(usersTable).where(and(...conditions));
  });
}

export async function listOnShiftUsers(req: AuthRequest) {
  return runInTenantContext(req.user!, async (tx) => {
    return tx
      .select(userSelect)
      .from(usersTable)
      .where(and(isNull(usersTable.deletedAt), eq(usersTable.clinicId, req.user!.clinicId), eq(usersTable.isOnShift, true)));
  });
}

export async function listDoctors(req: AuthRequest) {
  return runInTenantContext(req.user!, async (tx) => {
    return tx
      .select({
        id:         usersTable.id,
        fullName:   usersTable.fullName,
        fullNameAr: usersTable.fullNameAr,
        specialty:  usersTable.specialty,
      })
      .from(usersTable)
      .where(and(eq(usersTable.role, "doctor"), eq(usersTable.clinicId, req.user!.clinicId), eq(usersTable.isActive, true), isNull(usersTable.deletedAt)));
  });
}

export async function getUser(req: AuthRequest, userId: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const [user] = await tx.select(userSelect).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.clinicId, req.user!.clinicId)));
    if (!user) throw new NotFoundError("User not found");
    await logRead(req, "user", userId);
    return user;
  });
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
    addressLine?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  },
) {
  const { username, password, fullName, fullNameAr, email, role, phone, specialty, department, addressLine, city, region, postalCode, country } = body;
  if (!username || !password || !fullName || !role) {
    throw new ValidationError("Missing required fields: username, password, fullName, role");
  }

  if (role === "super_admin" && req.user!.role !== "super_admin") {
    await logAudit(req, "ESCALATION_DENIED", "user", undefined, { attemptedRole: role });
    throw new ForbiddenError("Only super admins can create super admin users");
  }

  if (specialty && !VALID_SPECIALTIES.includes(specialty as any)) {
    throw new ValidationError(`Invalid specialty. Valid values: ${VALID_SPECIALTIES.join(", ")}`);
  }

  const strength = await validatePasswordStrictAsync(password);
  if (!strength.valid) throw new ValidationError(strength.reason!);

  const hash = await hashPassword(password);
  return runInTenantContext(req.user!, async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({
        username,
        passwordHash: hash,
        fullName,
        fullNameAr,
        email,
        clinicId: req.user!.clinicId,
        role: role as any,
        phone,
        specialty,
        department,
        addressLine,
        city,
        region,
        postalCode,
        country,
      })
      .returning();

    await logAudit(req, "CREATE", "user", user.id);
    return { ...user, passwordHash: undefined };
  });
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
    addressLine?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  },
) {
  if (userId === req.user!.userId) {
    throw new ForbiddenError("Employees cannot edit their own profile. Please contact an administrator.");
  }

  const { fullName, fullNameAr, email, role, phone, isActive, isOnShift, specialty, department, addressLine, city, region, postalCode, country } = body;

  if (role === "super_admin" && req.user!.role !== "super_admin") {
    await logAudit(req, "ESCALATION_DENIED", "user", userId, { attemptedRole: role });
    throw new ForbiddenError("Only super admins can promote users to super admin");
  }

  if (specialty && !VALID_SPECIALTIES.includes(specialty as any)) {
    throw new ValidationError(`Invalid specialty. Valid values: ${VALID_SPECIALTIES.join(", ")}`);
  }

  return runInTenantContext(req.user!, async (tx) => {
    const conditions = [eq(usersTable.id, userId), eq(usersTable.clinicId, req.user!.clinicId), isNull(usersTable.deletedAt)];
    const [before] = await tx.select(userSelect).from(usersTable).where(and(...conditions));
    if (!before) throw new NotFoundError("User not found");

    // F-1: an admin must not be able to modify a super_admin (demote/deactivate/
    // change email → password-reset takeover). Only super_admin manages super_admin.
    if (!canManageTarget(req.user!.role, before.role)) {
      await logAudit(req, "ESCALATION_DENIED", "user", userId, { actorRole: req.user!.role, targetRole: before.role, action: "update_user" });
      throw new ForbiddenError("Only a super admin can modify a super admin account");
    }

    const [user] = await tx
      .update(usersTable)
      .set({ fullName, fullNameAr, email, role: role as any, phone, isActive, isOnShift, specialty, department, addressLine, city, region, postalCode, country, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (!user) throw new NotFoundError("User not found");

    if (before && before.role !== role) {
      await revokeAllTokensForUser(userId);
    }

    await logAudit(
      req,
      "UPDATE",
      "user",
      user.id,
      { fields: changedFields(before, user) },
      auditSnapshot(before),
      auditSnapshot(user),
    );
    return user;
  });
}

export async function toggleShift(req: AuthRequest, userId: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions = [eq(usersTable.id, userId), eq(usersTable.clinicId, req.user!.clinicId), isNull(usersTable.deletedAt)];
    const [current] = await tx
      .select({ isOnShift: usersTable.isOnShift, role: usersTable.role })
      .from(usersTable)
      .where(and(...conditions));
    if (!current) throw new NotFoundError("User not found");

    // F-1: only a super_admin may toggle a super_admin's shift state.
    if (!canManageTarget(req.user!.role, current.role)) {
      await logAudit(req, "ESCALATION_DENIED", "user", userId, { actorRole: req.user!.role, targetRole: current.role, action: "toggle_shift" });
      throw new ForbiddenError("Only a super admin can manage a super admin account");
    }

    const newShiftState = !current.isOnShift;
    const [user] = await tx
      .update(usersTable)
      .set({ isOnShift: newShiftState, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    await logAudit(req, "TOGGLE_SHIFT", "user", userId, { isOnShift: user.isOnShift });

    let shiftSummary: Record<string, number> | undefined;
    if (!newShiftState && current.role === "doctor") {
      const { start, end } = todayBoundary(getClinicTimezone(req));
      const appointments = await tx
        .select({ status: appointmentsTable.status })
        .from(appointmentsTable)
        .where(
          and(
            eq(appointmentsTable.doctorId, userId),
            eq(appointmentsTable.clinicId, req.user!.clinicId),
            gte(appointmentsTable.scheduledAt, start),
            lte(appointmentsTable.scheduledAt, end)
          )
        );

      shiftSummary = {
        total: appointments.length,
        completed: appointments.filter((a) => a.status === "completed").length,
        cancelled: appointments.filter((a) => a.status === "cancelled").length,
        remaining: appointments.filter((a) => !["completed", "cancelled", "no_show"].includes(a.status)).length,
      };
    }

    return shiftSummary ? { ...user, shiftSummary } : user;
  });
}

export async function deleteUser(req: AuthRequest, userId: number) {
  if (userId === req.user!.userId) {
    throw new ForbiddenError("You cannot delete your own account");
  }

  return runInTenantContext(req.user!, async (tx) => {
    const conditions = [eq(usersTable.id, userId), eq(usersTable.clinicId, req.user!.clinicId), isNull(usersTable.deletedAt)];

    // F-1: resolve the target's role before mutating so an admin cannot delete a super_admin.
    const [target] = await tx.select({ role: usersTable.role }).from(usersTable).where(and(...conditions));
    if (!target) throw new NotFoundError("User not found");
    if (!canManageTarget(req.user!.role, target.role)) {
      await logAudit(req, "ESCALATION_DENIED", "user", userId, { actorRole: req.user!.role, targetRole: target.role, action: "delete_user" });
      throw new ForbiddenError("Only a super admin can delete a super admin account");
    }

    const [user] = await tx
      .update(usersTable)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (!user) throw new NotFoundError("User not found");
    await logAudit(req, "DELETE", "user", user.id);
  });
}

export async function resetPassword(req: AuthRequest, userId: number, newPassword: string) {
  if (!newPassword) throw new ValidationError("New password required");

  const strength = await validatePasswordStrictAsync(newPassword);
  if (!strength.valid) throw new ValidationError(strength.reason!);

  const hash = await hashPassword(newPassword);
  return runInTenantContext(req.user!, async (tx) => {
    const conditions = [eq(usersTable.id, userId), eq(usersTable.clinicId, req.user!.clinicId), isNull(usersTable.deletedAt)];

    // F-1 (primary takeover vector): an admin resetting a super_admin's password
    // could then log in as super_admin. Resolve the target's role and refuse
    // before writing the new hash. Only super_admin may reset a super_admin.
    const [target] = await tx.select({ role: usersTable.role }).from(usersTable).where(and(...conditions));
    if (!target) throw new NotFoundError("User not found");
    if (!canManageTarget(req.user!.role, target.role)) {
      await logAudit(req, "ESCALATION_DENIED", "user", userId, { actorRole: req.user!.role, targetRole: target.role, action: "reset_password" });
      throw new ForbiddenError("Only a super admin can reset a super admin's password");
    }

    const [updated] = await tx
      .update(usersTable)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!updated) throw new NotFoundError("User not found");

    await logAudit(req, "RESET_PASSWORD", "user", userId);
  });
}
