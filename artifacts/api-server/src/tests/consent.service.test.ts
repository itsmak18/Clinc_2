import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
  return {
    db: mockDb,
    runInTenantContext: vi.fn().mockImplementation((user, fn) => fn(mockDb)),
    patientConsentsTable: {
      id: "id", patientId: "patientId", consentType: "consentType",
      revokedAt: "revokedAt", grantedAt: "grantedAt",
    },
    patientsTable: { id: "id" },
  };
});

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { hasActiveConsent, grantConsent, revokeConsent } from "../services/consent.service";
import { db } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";

function mockReq(role = "admin", userId = 1): AuthRequest {
  return {
    user: { userId, username: "admin", role },
    ip: "127.0.0.1",
    socket: {},
  } as unknown as AuthRequest;
}

// select().from().where().limit() → resolves to rows
function mockSelectWithLimit(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// select().from().where() → resolves to rows (no .limit())
function mockSelectDirect(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

// update().set().where() → resolves (no .returning())
function mockUpdateChain(rows: unknown[] = []) {
  const where = vi.fn().mockResolvedValue(rows);
  const set = vi.fn().mockReturnValue({ where });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set });
}

// update().set().where().returning() → resolves to rows
function mockUpdateReturning(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set });
}

// insert().values().returning() → resolves to [row]
function mockInsertChain(row: unknown) {
  const returning = vi.fn().mockResolvedValue([row]);
  const values = vi.fn().mockReturnValue({ returning });
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hasActiveConsent", () => {
  it("returns true when an active consent row exists", async () => {
    mockSelectWithLimit([{ id: 1 }]);
    expect(await hasActiveConsent(5, "treatment")).toBe(true);
  });

  it("returns false when no active consent exists", async () => {
    mockSelectWithLimit([]);
    expect(await hasActiveConsent(5, "treatment")).toBe(false);
  });
});

describe("grantConsent", () => {
  it("throws ValidationError for an unknown consent type", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      grantConsent(mockReq(), 5, { consentType: "unknown_type", documentVersion: "v1" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when documentVersion is missing", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      grantConsent(mockReq(), 5, { consentType: "treatment" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("grants consent and returns the new row", async () => {
    const consent = {
      id: 1, patientId: 5, consentType: "treatment", documentVersion: "v1",
      grantedAt: new Date(), revokedAt: null,
    };

    // grantConsent does: select (patient check, no limit) → update (revoke existing) → insert
    mockSelectDirect([{ id: 5 }]);
    mockUpdateChain([]);
    mockInsertChain(consent);

    const result = await grantConsent(mockReq(), 5, { consentType: "treatment", documentVersion: "v1" });
    expect(result.consentType).toBe("treatment");
    expect(result.id).toBe(1);
  });

  it("throws NotFoundError when patient does not exist", async () => {
    const { NotFoundError } = await import("../services/errors");
    mockSelectDirect([]);
    await expect(
      grantConsent(mockReq(), 99, { consentType: "treatment", documentVersion: "v1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("revokeConsent", () => {
  it("throws NotFoundError when consent does not exist", async () => {
    const { NotFoundError } = await import("../services/errors");
    mockSelectDirect([]);
    await expect(revokeConsent(mockReq(), 5, 99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError when consent is already revoked", async () => {
    const { ConflictError } = await import("../services/errors");
    mockSelectDirect([{ id: 1, patientId: 5, revokedAt: new Date(), consentType: "treatment" }]);
    await expect(revokeConsent(mockReq(), 5, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it("revokes an active consent", async () => {
    const updated = { id: 1, patientId: 5, consentType: "treatment", revokedAt: new Date() };
    mockSelectDirect([{ id: 1, patientId: 5, consentType: "treatment", revokedAt: null }]);
    mockUpdateReturning([updated]);

    const result = await revokeConsent(mockReq(), 5, 1);
    expect(result.revokedAt).toBeDefined();
  });
});
