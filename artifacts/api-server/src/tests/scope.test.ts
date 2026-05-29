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
  medicalRecordsTable: { id: "id", doctorId: "doctorId" },
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logDenied: vi.fn().mockResolvedValue(undefined),
}));

import { isDoctorScoped, getDoctorPatientScope, assertPatientInScope, assertMedicalRecordInScope, recordDoctorPatientLink } from "../lib/scope";
import { db } from "@workspace/db";
import { logAudit, logDenied } from "../lib/audit";
import type { AuthRequest } from "../middlewares/auth";

// ── Helper to build a mock request ───────────────────────────────────────────

function doctorReq(userId = 5): AuthRequest {
  return { user: { userId, username: "dr_test", role: "doctor" } } as unknown as AuthRequest;
}

function adminReq(): AuthRequest {
  return { user: { userId: 1, username: "admin", role: "admin" } } as unknown as AuthRequest;
}

function superAdminReq(): AuthRequest {
  return { user: { userId: 2, username: "sa", role: "super_admin" } } as unknown as AuthRequest;
}

// Chain mock helper: db.select().from().where() → resolves rows (doctor_patients lookup)
function mockScopeQuery(patientIds: number[]) {
  const where = vi.fn().mockResolvedValue(patientIds.map(id => ({ patientId: id })));
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// Chain mock helper: db.select().from().where() → resolves rows
function mockRecordQuery(record: { doctorId: number } | null) {
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
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns true immediately for non-doctor roles (admin)", async () => {
    const result = await assertPatientInScope(adminReq(), 99);
    expect(result).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns true immediately for super_admin", async () => {
    const result = await assertPatientInScope(superAdminReq(), 99);
    expect(result).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns true when patient IS in doctor scope", async () => {
    mockScopeQuery([10, 20]);
    const result = await assertPatientInScope(doctorReq(), 10);
    expect(result).toBe(true);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("returns false and logs audit when patient is NOT in scope", async () => {
    mockScopeQuery([10, 20]);
    const result = await assertPatientInScope(doctorReq(), 999);
    expect(result).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "ACCESS_DENIED_OUT_OF_SCOPE",
      expect.any(String),
      999,
      expect.objectContaining({ reason: "patient not assigned to doctor" }),
    );
  });

  it("uses provided entityType in audit log", async () => {
    mockScopeQuery([]);
    await assertPatientInScope(doctorReq(), 5, "custom_entity");
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "ACCESS_DENIED_OUT_OF_SCOPE",
      "custom_entity",
      5,
      expect.anything(),
    );
  });

  it("returns false when doctor has zero appointments (empty scope)", async () => {
    mockScopeQuery([]);
    const result = await assertPatientInScope(doctorReq(), 1);
    expect(result).toBe(false);
  });
});

// ── assertMedicalRecordInScope ────────────────────────────────────────────────

describe("assertMedicalRecordInScope", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns true immediately for non-doctor roles", async () => {
    const result = await assertMedicalRecordInScope(adminReq(), 42);
    expect(result).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns true immediately for super_admin", async () => {
    const result = await assertMedicalRecordInScope(superAdminReq(), 42);
    expect(result).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("[Rule 1] returns true when record.doctorId matches current user", async () => {
    mockRecordQuery({ doctorId: 5 });
    const result = await assertMedicalRecordInScope(doctorReq(5), 42);
    expect(result).toBe(true);
    expect(logDenied).not.toHaveBeenCalled();
  });

  it("[Rule 2] returns false and logs denied when different doctor owns the record", async () => {
    mockRecordQuery({ doctorId: 999 });
    const result = await assertMedicalRecordInScope(doctorReq(5), 42);
    expect(result).toBe(false);
    expect(logDenied).toHaveBeenCalledWith(
      expect.anything(),
      "medical_record",
      42,
      "record_not_owned",
    );
  });

  it("returns true (let caller handle 404) when record does not exist", async () => {
    mockRecordQuery(null);
    const result = await assertMedicalRecordInScope(doctorReq(5), 9999);
    expect(result).toBe(true);
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
