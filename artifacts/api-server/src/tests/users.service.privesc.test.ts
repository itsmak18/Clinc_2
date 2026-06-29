/**
 * users.service.privesc.test.ts
 *
 * Regression coverage for F-1: an `admin` must not be able to act ON a
 * `super_admin` (reset password → log in as them, demote, deactivate, delete).
 * Two layers:
 *   1. canManageTarget(actorRole, targetRole) — the pure security decision.
 *   2. resetPassword / updateUser / deleteUser — prove the guard is WIRED IN
 *      (the privileged write never runs when the target is a super_admin).
 *
 * Mirrors the @workspace/db mock pattern in clinic-notices.service.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogAudit = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
  const __m: any = {
    db: mockDb,
    runInTenantContext: vi.fn().mockImplementation((_user: any, fn: any) => fn(mockDb)),
    usersTable: {
      id: "id", clinicId: "clinicId", username: "username", role: "role",
      passwordHash: "passwordHash", isActive: "isActive", isOnShift: "isOnShift",
      deletedAt: "deletedAt", updatedAt: "updatedAt", fullName: "fullName",
      fullNameAr: "fullNameAr", email: "email", phone: "phone", specialty: "specialty",
      department: "department", addressLine: "addressLine", city: "city",
      region: "region", postalCode: "postalCode", country: "country", createdAt: "createdAt",
    },
    appointmentsTable: {
      id: "id", clinicId: "clinicId", doctorId: "doctorId", status: "status", scheduledAt: "scheduledAt",
    },
  };
  __m.dbUnsafe = __m.db;
  return __m;
});

vi.mock("../lib/audit", () => ({
  logAudit: mockLogAudit,
  logRead: vi.fn(),
  auditSnapshot: (x: any) => x,
  changedFields: () => [],
}));

vi.mock("../lib/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-pw"),
  validatePasswordStrictAsync: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock("../lib/auth", () => ({ revokeAllTokensForUser: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../lib/dateUtils", () => ({
  todayBoundary: () => ({ start: new Date(), end: new Date() }),
  getClinicTimezone: () => "UTC",
}));

vi.mock("../services/errors", () => {
  class NotFoundError extends Error {}
  class ForbiddenError extends Error {}
  class ValidationError extends Error {}
  return { NotFoundError, ForbiddenError, ValidationError };
});

import { canManageTarget, resetPassword, updateUser, deleteUser } from "../modules/identity/users.service";
import { db } from "@workspace/db";
import { ForbiddenError } from "../services/errors";

const mockDb = db as any;

function makeReq(role: string, userId = 1, clinicId = 1) {
  return { user: { userId, role, clinicId, username: "actor" } } as any;
}
// tx.select(...).from(...).where(...) → Promise<rows>
const selectReturning = (rows: any[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
// tx.update(...).set(...).where(...).returning() → Promise<rows>
const updateReturning = (rows: any[]) => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockLogAudit.mockResolvedValue(undefined);
});

describe("canManageTarget (pure policy)", () => {
  it("super_admin can manage anyone, including another super_admin", () => {
    expect(canManageTarget("super_admin", "super_admin")).toBe(true);
    expect(canManageTarget("super_admin", "admin")).toBe(true);
    expect(canManageTarget("super_admin", "doctor")).toBe(true);
  });

  it("admin can manage every non-super_admin role", () => {
    for (const r of ["admin", "doctor", "nurse", "front_desk", "billing_manager", "compliance_officer"]) {
      expect(canManageTarget("admin", r)).toBe(true);
    }
  });

  it("admin (and any non-super_admin) CANNOT manage a super_admin — F-1", () => {
    expect(canManageTarget("admin", "super_admin")).toBe(false);
    expect(canManageTarget("compliance_officer", "super_admin")).toBe(false);
    expect(canManageTarget("doctor", "super_admin")).toBe(false);
  });
});

describe("resetPassword wiring (F-1 takeover vector)", () => {
  it("rejects an admin resetting a super_admin's password and never writes the hash", async () => {
    mockDb.select.mockReturnValue(selectReturning([{ role: "super_admin" }]));
    await expect(resetPassword(makeReq("admin"), 99, "Sup3r$ecret!")).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.anything(), "ESCALATION_DENIED", "user", 99, expect.objectContaining({ action: "reset_password" }),
    );
  });

  it("allows an admin resetting a nurse's password", async () => {
    mockDb.select.mockReturnValue(selectReturning([{ role: "nurse" }]));
    mockDb.update.mockReturnValue(updateReturning([{ id: 99 }]));
    await expect(resetPassword(makeReq("admin"), 99, "Sup3r$ecret!")).resolves.toBeUndefined();
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("allows a super_admin resetting a super_admin's password", async () => {
    mockDb.select.mockReturnValue(selectReturning([{ role: "super_admin" }]));
    mockDb.update.mockReturnValue(updateReturning([{ id: 99 }]));
    await expect(resetPassword(makeReq("super_admin"), 99, "Sup3r$ecret!")).resolves.toBeUndefined();
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });
});

describe("deleteUser wiring (F-1)", () => {
  it("rejects an admin deleting a super_admin and never soft-deletes", async () => {
    mockDb.select.mockReturnValue(selectReturning([{ role: "super_admin" }]));
    await expect(deleteUser(makeReq("admin"), 99)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe("updateUser wiring (F-1)", () => {
  it("rejects an admin modifying a super_admin and never updates", async () => {
    mockDb.select.mockReturnValue(selectReturning([{ id: 99, role: "super_admin" }]));
    await expect(updateUser(makeReq("admin"), 99, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
