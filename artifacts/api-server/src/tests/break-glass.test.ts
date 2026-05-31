import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
  breakGlassSessionsTable: {
    id: "id", userId: "userId", patientId: "patientId", clinicId: "clinicId",
    revokedAt: "revokedAt", expiresAt: "expiresAt",
  },
  patientsTable: { id: "id", fullName: "fullName", clinicId: "clinicId" },
  usersTable: { id: "id", role: "role", clinicId: "clinicId" },
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/sse", () => ({
  emitToUser: vi.fn(),
}));

import { activateBreakGlass, revokeBreakGlass, getActiveSession } from "../services/break-glass.service";
import { db } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";

function req(userId = 3, role = "doctor"): AuthRequest {
  return { user: { userId, username: "dr_x", role, clinicId: 1 }, ip: "127.0.0.1", socket: {} } as unknown as AuthRequest;
}

const VALID_JUSTIFICATION = "Emergency — patient unconscious, need to review history immediately";
const VALID_BODY = { justification: VALID_JUSTIFICATION, reasonCategory: "patient_unconscious" };

// select().from().where() → resolves directly (no limit)
function mockSelectDirect(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// select().from().where().limit() → resolves to rows
function mockSelectWithLimit(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// update().set().where().returning() → resolves to rows
function mockUpdateReturning(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set });
}

beforeEach(() => vi.clearAllMocks());

describe("activateBreakGlass", () => {
  it("throws ValidationError when justification is too short", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      activateBreakGlass(req(), 10, { justification: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when reasonCategory is missing or invalid", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      activateBreakGlass(req(), 10, { justification: VALID_JUSTIFICATION }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      activateBreakGlass(req(), 10, { justification: VALID_JUSTIFICATION, reasonCategory: "not_a_real_category" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when patient does not exist", async () => {
    const { NotFoundError } = await import("../services/errors");
    // activateBreakGlass: db.select({id,fullName}).from(patients).where() — no .limit()
    mockSelectDirect([]);
    await expect(
      activateBreakGlass(req(), 99, VALID_BODY),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError when an active session already exists", async () => {
    const { ConflictError } = await import("../services/errors");

    // activateBreakGlass calls:
    //   1. db.select({id,fullName}).from(patients).where()           — no .limit() (direct)
    //   2. getActiveSession → db.select().from(sessions).where().limit(1)
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const currentCall = callCount;
      if (currentCall === 1) {
        // Patient check: .where() resolves directly
        const where = vi.fn().mockResolvedValue([{ id: 10, fullName: "John" }]);
        const from = vi.fn().mockReturnValue({ where });
        return { from };
      }
      // getActiveSession: .where().limit()
      const limit = vi.fn().mockResolvedValue([
        { id: 5, userId: 3, patientId: 10, expiresAt: new Date(Date.now() + 60_000) },
      ]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      return { from };
    });

    await expect(
      activateBreakGlass(req(), 10, VALID_BODY),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("getActiveSession", () => {
  it("returns null when no active session exists", async () => {
    mockSelectWithLimit([]);
    expect(await getActiveSession(3, 10, 1)).toBeNull();
  });

  it("returns the session when one exists", async () => {
    const session = { id: 1, userId: 3, patientId: 10, expiresAt: new Date(Date.now() + 60_000) };
    mockSelectWithLimit([session]);
    expect(await getActiveSession(3, 10, 1)).toEqual(session);
  });
});

describe("revokeBreakGlass", () => {
  it("throws NotFoundError when session does not exist", async () => {
    const { NotFoundError } = await import("../services/errors");
    // revokeBreakGlass: db.select().from().where() — no .limit()
    mockSelectDirect([]);
    await expect(revokeBreakGlass(req(), 99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError when already revoked", async () => {
    const { ConflictError } = await import("../services/errors");
    mockSelectDirect([{ id: 1, userId: 3, revokedAt: new Date(), patientId: 10 }]);
    await expect(revokeBreakGlass(req(), 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it("[INVARIANT] non-owner non-compliance role cannot revoke another user's session", async () => {
    const { ForbiddenError } = await import("../services/errors");
    mockSelectDirect([{ id: 1, userId: 99, revokedAt: null, patientId: 10 }]);
    await expect(revokeBreakGlass(req(3, "doctor"), 1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("revokes session when caller is the owner", async () => {
    const revoked = { id: 1, userId: 3, revokedAt: new Date(), patientId: 10 };
    mockSelectDirect([{ id: 1, userId: 3, revokedAt: null, patientId: 10 }]);
    mockUpdateReturning([revoked]);

    const result = await revokeBreakGlass(req(3, "doctor"), 1);
    expect(result.revokedAt).toBeDefined();
  });
});
