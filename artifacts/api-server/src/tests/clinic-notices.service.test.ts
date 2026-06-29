import { describe, it, expect, vi, beforeEach } from "vitest";

// â”€â”€ Hoisted mock handles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const mockLogAudit = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const __m: any = {
    db: mockDb,
    runInTenantContext: vi.fn().mockImplementation((user, fn) => fn(mockDb)),
    clinicNoticesTable: {
      id: "id",
      clinicId: "clinicId",
      title: "title",
      content: "content",
      createdBy: "createdBy",
      reason: "reason",
      deletedAt: "deletedAt",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  };
  __m.dbUnsafe = __m.db;
  return __m;
});

vi.mock("../lib/audit", () => ({
  logAudit: mockLogAudit.mockResolvedValue(undefined),
}));

vi.mock("../services/errors", () => {
  class NotFoundError extends Error {
    constructor(type: string, id: unknown) { super(`${type} ${id} not found`); }
  }
  class ValidationError extends Error {
    constructor(msg: string) { super(msg); }
  }
  return { NotFoundError, ValidationError };
});

import { listClinicNotices, createClinicNotice, deleteClinicNotice } from "../modules/clinical/clinic-notices.service";
import { db } from "@workspace/db";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeReq(role = "super_admin", userId = 1, clinicId = 1) {
  return {
    user: { userId, role, clinicId, username: "testuser" },
  } as any;
}

const NOTICE_UUID = "01960000-0000-7000-8000-000000000001";

const SAMPLE_NOTICE = {
  id: NOTICE_UUID, clinicId: 1, title: "A title", content: "Content body text here",
  createdBy: 1, reason: "Reason with enough characters", deletedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

// â”€â”€ listClinicNotices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("listClinicNotices", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns paginated results with nextCursor null when fewer than limit", async () => {
    const rows = [SAMPLE_NOTICE];
    const where = vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
    });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });

    const result = await listClinicNotices(makeReq(), {});
    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("returns nextCursor equal to last row id (UUID) when results fill the page", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      ...SAMPLE_NOTICE,
      id: `01960000-0000-7000-8000-${String(i).padStart(12, "0")}`,
    }));
    const where = vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
    });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });

    const result = await listClinicNotices(makeReq(), { limit: "50" });
    expect(result.data).toHaveLength(50);
    expect(result.nextCursor).toBe(rows[49].id);
  });

  it("logs a READ_LIST audit entry", async () => {
    const rows = [SAMPLE_NOTICE];
    const where = vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
    });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });

    await listClinicNotices(makeReq(), {});
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.anything(),
      "READ_LIST",
      "clinic_notice",
      undefined,
      expect.objectContaining({ count: 1 }),
    );
  });
});

// â”€â”€ createClinicNotice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("createClinicNotice", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates a notice and logs audit with UUID entityId", async () => {
    const returning = vi.fn().mockResolvedValue([SAMPLE_NOTICE]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });

    const result = await createClinicNotice(makeReq(), {
      title: "A valid title",
      content: "Content that is long enough",
      reason: "Reason that is at least twenty characters long",
    });
    expect(result).toEqual(SAMPLE_NOTICE);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.anything(), "CREATE", "clinic_notice", NOTICE_UUID,
    );
  });

  it("throws ValidationError when title is too short", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      createClinicNotice(makeReq(), { title: "Hi", content: "Long enough content here", reason: "Reason at least twenty chars" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when content is too short", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      createClinicNotice(makeReq(), { title: "Valid title", content: "Short", reason: "Reason at least twenty chars" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when reason is under 20 chars", async () => {
    const { ValidationError } = await import("../services/errors");
    await expect(
      createClinicNotice(makeReq(), { title: "Valid title", content: "Long enough content here", reason: "Too short" })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// â”€â”€ deleteClinicNotice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("deleteClinicNotice", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("soft-deletes the notice and logs audit with UUID entityId", async () => {
    const where1 = vi.fn().mockResolvedValue([{ id: NOTICE_UUID }]);
    const from1 = vi.fn().mockReturnValue({ where: where1 });
    const where2 = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: where2 });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({ from: from1 });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set });

    await deleteClinicNotice(makeReq(), NOTICE_UUID);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.anything(), "DELETE", "clinic_notice", NOTICE_UUID,
    );
  });

  it("throws NotFoundError when notice does not exist", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });

    const { NotFoundError } = await import("../services/errors");
    await expect(
      deleteClinicNotice(makeReq(), "01960000-0000-7000-8000-000000000099")
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
