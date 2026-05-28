import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() },
  erasureRequestsTable: {
    id: "id", patientId: "patientId", status: "status", executedAt: "executedAt",
  },
  patientsTable: { id: "id" },
  medicalRecordsTable: { patientId: "patientId" },
  prescriptionsTable: { patientId: "patientId", deletedAt: "deletedAt" },
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { createErasureRequest, reviewErasureRequest, executeErasure } from "../services/erasure.service";
import { db } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";

function req(role = "compliance_officer", userId = 4): AuthRequest {
  return { user: { userId, username: "compliance", role }, ip: "127.0.0.1", socket: {} } as unknown as AuthRequest;
}

function superAdminReq(): AuthRequest {
  return { user: { userId: 1, username: "sa", role: "super_admin" }, ip: "127.0.0.1", socket: {} } as unknown as AuthRequest;
}

// select().from().where() → resolves directly (no .limit())
function mockSelectDirect(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// select().from().where().limit() → resolves with rows
function mockSelectWithLimit(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

beforeEach(() => vi.clearAllMocks());

describe("createErasureRequest", () => {
  it("throws ValidationError when reason is too short", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      createErasureRequest(req(), { patientId: 5, reason: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when patient does not exist", async () => {
    const { NotFoundError } = await import("../services/errors");
    mockSelectDirect([]);
    await expect(
      createErasureRequest(req(), { patientId: 99, reason: "Patient deceased, family requests deletion" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates a request and returns it", async () => {
    const requestRow = { id: 1, patientId: 5, status: "pending", requestedByUserId: 4 };
    mockSelectDirect([{ id: 5 }]);

    const returning = vi.fn().mockResolvedValue([requestRow]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });

    const result = await createErasureRequest(req(), { patientId: 5, reason: "Patient deceased, family requests deletion" });
    expect(result.status).toBe("pending");
  });
});

describe("reviewErasureRequest", () => {
  it("throws ValidationError for invalid action", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      reviewErasureRequest(req(), 1, { action: "delete" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when request does not exist", async () => {
    const { NotFoundError } = await import("../services/errors");
    mockSelectDirect([]);
    await expect(
      reviewErasureRequest(req(), 99, { action: "approve" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError when request is not pending", async () => {
    const { ConflictError } = await import("../services/errors");
    mockSelectDirect([{ id: 1, status: "executed", executedAt: new Date() }]);
    await expect(
      reviewErasureRequest(req(), 1, { action: "approve" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("approves a pending request", async () => {
    const updated = { id: 1, status: "approved", reviewedByUserId: 4, reviewedAt: new Date() };
    mockSelectDirect([{ id: 1, status: "pending", executedAt: null, patientId: 5 }]);
    // reviewErasureRequest: update().set().where().returning()
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set });

    const result = await reviewErasureRequest(req(), 1, { action: "approve" });
    expect(result.status).toBe("approved");
  });
});

describe("executeErasure", () => {
  it("[INVARIANT] non-super_admin cannot execute", async () => {
    const { ForbiddenError } = await import("../services/errors");
    await expect(
      executeErasure(req("compliance_officer"), 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError when request does not exist", async () => {
    const { NotFoundError } = await import("../services/errors");
    mockSelectDirect([]);
    await expect(executeErasure(superAdminReq(), 99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError when request is not approved", async () => {
    const { ConflictError } = await import("../services/errors");
    mockSelectDirect([{ id: 1, status: "pending", executedAt: null }]);
    await expect(executeErasure(superAdminReq(), 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it("executes anonymization via transaction and returns ok", async () => {
    mockSelectDirect([{ id: 1, status: "approved", executedAt: null, patientId: 5 }]);
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (tx: typeof db) => Promise<void>) => {
      const mockSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
      const tx = { update: vi.fn().mockReturnValue({ set: mockSet }) };
      await fn(tx as any);
    });
    const result = await executeErasure(superAdminReq(), 1);
    expect(result.ok).toBe(true);
    expect(result.patientId).toBe(5);
  });
});
