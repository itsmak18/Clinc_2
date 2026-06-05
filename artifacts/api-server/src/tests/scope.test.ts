/**
 * scope.test.ts
 *
 * 100% branch coverage is REQUIRED on scope.ts.
 * These functions are the RBAC enforcement layer for doctor-scoped PHI access.
 * A regression here = PHI exposure in production.
 *
 * Strategy: mock @workspace/db so tests run without a real DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db before importing scope ─────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  doctorPatientsTable: { doctorId: "doctorId", patientId: "patientId" },
  medicalRecordsTable: { id: "id", doctorId: "doctorId", patientId: "patientId" },
  breakGlassSessionsTable: {
    id: "id", userId: "userId", patientId: "patientId", clinicId: "clinicId",
    revokedAt: "revokedAt", expiresAt: "expiresAt", activatedAt: "activatedAt",
    approvedAt: "approvedAt",
  },
  runInTenantContext: vi.fn().mockImplementation((_user: any, fn: (tx: any) => any) => {
    const db: any = { select: vi.fn() };
    return fn(db);
  }),
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logDenied: vi.fn().mockResolvedValue(undefined),
}));

// Break-glass service mock — default: no active session (getActiveSession → null).
// Individual tests override this to simulate an active session.
vi.mock("../services/break-glass.service", () => ({
  getActiveSession: vi.fn().mockResolvedValue(null),
  logBreakGlassAccess: vi.fn().mockResolvedValue(undefined),
  getActiveBreakGlassPatientIds: vi.fn().mockResolvedValue([]),
}));

import { isDoctorScoped, getDoctorPatientScope, assertPatientInScope, assertMedicalRecordInScope, recordDoctorPatientLink } from "../lib/scope";
import { db } from "@workspace/db";
import { logAudit, logDenied } from "../lib/audit";
import { ForbiddenError } from "../services/errors";
import { getActiveSession, logBreakGlassAccess } from "../services/break-glass.service";
import type { AuthRequest } from "../middlewares/auth";

// ── Helper to build a mock request ───────────────────────────────────────────

function doctorReq(userId = 5, clinicId = 1): AuthRequest {
  return { user: { userId, username: "dr_test", role: "doctor", clinicId } } as unknown as AuthRequest;
}

function adminReq(): AuthRequest {
  return { user: { userId: 1, username: "admin", role: "admin", clinicId: 1 } } as unknown as AuthRequest;
}

function superAdminReq(): AuthRequest {
  return { user: { userId: 2, username: "sa", role: "super_admin", clinicId: 1 } } as unknown as AuthRequest;
}

// Chain mock helper: db.select().from().where() → resolves rows (doctor_patients lookup)
function mockScopeQuery(patientIds: number[]) {
  const where = vi.fn().mockResolvedValue(patientIds.map(id => ({ patientId: id })));
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// Chain mock helper: db.select().from().where() → resolves rows
function mockRecordQuery(record: { doctorId: number; patientId?: number } | null) {
  const where = vi.fn().mockResolvedValue(record ? [record] : []);
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// ── isDoctorScoped ────────────────────────────────────────────────────────────

describe("isDoctorScoped", () => {
  it("returns true for 'doctor'", () => {
    expect(isDoctorScoped("doctor")).toBe(true);
  });

  it("returns false for every other role", () => {
    const others = ["super_admin", "admin", "nurse", "front_desk", "xray_staff", "lab_staff", undefined];
    for (const role of others) {
      expect(isDoctorScoped(role)).toBe(false);
    }
  });
});

// ── getDoctorPatientScope ─────────────────────────────────────────────────────

describe("getDoctorPatientScope", () => {
  it("returns patient IDs from the DB query result", async () => {
    mockScopeQuery([10, 20, 30]);
    const result = await getDoctorPatientScope(5);
    expect(result).toEqual([10, 20, 30]);
  });

  it("returns empty array when doctor has no appointments", async () => {
    mockScopeQuery([]);
    const result = await getDoctorPatientScope(5);
    expect(result).toEqual([]);
  });
});

// ── assertPatientInScope ──────────────────────────────────────────────────────

describe("assertPatientInScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no active break-glass session
    (getActiveSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("resolves silently for non-doctor roles (admin)", async () => {
    await expect(assertPatientInScope(adminReq(), 99)).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("resolves silently for super_admin", async () => {
    await expect(assertPatientInScope(superAdminReq(), 99)).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("resolves silently when patient IS in doctor scope", async () => {
    mockScopeQuery([10, 20]);
    await expect(assertPatientInScope(doctorReq(), 10)).resolves.toBeUndefined();
    expect(logAudit).not.toHaveBeenCalled();
    expect(getActiveSession).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError and logs audit when patient is NOT in scope and no break-glass session", async () => {
    mockScopeQuery([10, 20]);
    await expect(assertPatientInScope(doctorReq(), 999)).rejects.toBeInstanceOf(ForbiddenError);
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "ACCESS_DENIED_OUT_OF_SCOPE",
      expect.any(String),
      999,
      expect.objectContaining({ reason: "patient not assigned to doctor" }),
    );
  });

  it("uses provided entityType in audit log on throw", async () => {
    mockScopeQuery([]);
    await expect(assertPatientInScope(doctorReq(), 5, "custom_entity")).rejects.toBeInstanceOf(ForbiddenError);
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "ACCESS_DENIED_OUT_OF_SCOPE",
      "custom_entity",
      5,
      expect.anything(),
    );
  });

  it("throws when doctor has zero appointments (empty scope) and no break-glass session", async () => {
    mockScopeQuery([]);
    await expect(assertPatientInScope(doctorReq(), 1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ── Break-glass integration ────────────────────────────────────────────────

  it("[break-glass] resolves silently and logs BREAK_GLASS_ACCESS when active session exists", async () => {
    mockScopeQuery([10, 20]); // patientId=999 not in scope
    const fakeSession = { id: 42, userId: 5, patientId: 999, clinicId: 1 };
    (getActiveSession as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSession);

    await expect(assertPatientInScope(doctorReq(5, 1), 999)).resolves.toBeUndefined();

    expect(getActiveSession).toHaveBeenCalledWith(5, 999, 1);
    expect(logBreakGlassAccess).toHaveBeenCalledWith(
      expect.anything(),
      42,
      "patient",
      999,
    );
    // Must NOT log ACCESS_DENIED_OUT_OF_SCOPE
    expect(logAudit).not.toHaveBeenCalledWith(
      expect.anything(),
      "ACCESS_DENIED_OUT_OF_SCOPE",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("[break-glass] uses custom entityType in BREAK_GLASS_ACCESS log", async () => {
    mockScopeQuery([]);
    const fakeSession = { id: 7, userId: 5, patientId: 3, clinicId: 1 };
    (getActiveSession as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSession);

    await expect(assertPatientInScope(doctorReq(5, 1), 3, "medical_record")).resolves.toBeUndefined();

    expect(logBreakGlassAccess).toHaveBeenCalledWith(
      expect.anything(),
      7,
      "medical_record",
      3,
    );
  });

  it("[break-glass] still throws when getActiveSession returns null (no session)", async () => {
    mockScopeQuery([]);
    (getActiveSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(assertPatientInScope(doctorReq(), 1)).rejects.toBeInstanceOf(ForbiddenError);
    expect(logBreakGlassAccess).not.toHaveBeenCalled();
  });
});

// ── assertMedicalRecordInScope ────────────────────────────────────────────────

describe("assertMedicalRecordInScope", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("resolves silently for non-doctor roles", async () => {
    await expect(assertMedicalRecordInScope(adminReq(), 42)).resolves.toEqual({ breakGlassPatientIds: [] });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("resolves silently for super_admin", async () => {
    await expect(assertMedicalRecordInScope(superAdminReq(), 42)).resolves.toEqual({ breakGlassPatientIds: [] });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("[Rule 1] resolves silently when record.doctorId matches current user", async () => {
    mockRecordQuery({ doctorId: 5 });
    await expect(assertMedicalRecordInScope(doctorReq(5), 42)).resolves.toEqual({ breakGlassPatientIds: [] });
    expect(logDenied).not.toHaveBeenCalled();
  });

  it("[Rule 2] throws ForbiddenError and logs denied when different doctor owns the record", async () => {
    mockRecordQuery({ doctorId: 999 });
    await expect(assertMedicalRecordInScope(doctorReq(5), 42)).rejects.toBeInstanceOf(ForbiddenError);
    expect(logDenied).toHaveBeenCalledWith(
      expect.anything(),
      "medical_record",
      42,
      "record_not_owned",
    );
  });

  it("resolves silently (let caller handle 404) when record does not exist", async () => {
    mockRecordQuery(null);
    await expect(assertMedicalRecordInScope(doctorReq(5), 9999)).resolves.toEqual({ breakGlassPatientIds: [] });
    expect(logDenied).not.toHaveBeenCalled();
  });

  it("[break-glass] allows a non-owned record when an active session exists, returns the patient id, audits", async () => {
    mockRecordQuery({ doctorId: 999, patientId: 77 });
    (getActiveSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1234 });

    await expect(assertMedicalRecordInScope(doctorReq(5), 42)).resolves.toEqual({ breakGlassPatientIds: [77] });
    expect(logBreakGlassAccess).toHaveBeenCalledWith(expect.anything(), 1234, "medical_record", 42);
    expect(logDenied).not.toHaveBeenCalled();
  });
});

// ── recordDoctorPatientLink ───────────────────────────────────────────────────

describe("recordDoctorPatientLink", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("inserts with correct args and onConflictDoUpdate", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });

    const lastSeenAt = new Date("2026-01-15T10:00:00Z");
    await recordDoctorPatientLink(1, 5, 10, lastSeenAt);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({ clinicId: 1, doctorId: 5, patientId: 10, lastSeenAt });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.anything(),
        set: expect.objectContaining({ lastSeenAt: expect.anything() }),
      }),
    );
  });

  it("uses current date as lastSeenAt when omitted", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });

    const before = Date.now();
    await recordDoctorPatientLink(1, 5, 10);
    const after = Date.now();

    const callArg = (values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.lastSeenAt).toBeInstanceOf(Date);
    expect(callArg.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(callArg.lastSeenAt.getTime()).toBeLessThanOrEqual(after);
  });
});
