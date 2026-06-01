import { describe, it, expect, vi, beforeEach } from "vitest";

// â”€â”€ Mock @workspace/db â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
vi.mock("@workspace/db", () => {
  const select = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();

  const __m: any = {
    db: { select, insert, update },
    auditLogsTable: { id: "id", userId: "userId", clinicId: "clinicId", action: "action", entityType: "entityType", entityId: "entityId", createdAt: "createdAt" },
    auditIntegrityChecksTable: { checkedDate: "checkedDate", rootHash: "rootHash", prevHash: "prevHash", rowCount: "rowCount", status: "status", verifiedAt: "verifiedAt" },
  };
  __m.dbUnsafe = __m.db;
  return __m;
});

// â”€â”€ Mock metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const mockIncrement = vi.hoisted(() => vi.fn());
vi.mock("../lib/metrics", () => ({
  auditIntegrityMismatchTotal: { inc: mockIncrement },
}));

// â”€â”€ Mock logger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

// â”€â”€ Mock drizzle-orm operators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  gte: vi.fn((col: unknown, val: unknown) => ({ op: "gte", col, val })),
  lt: vi.fn((col: unknown, val: unknown) => ({ op: "lt", col, val })),
  asc: vi.fn((col: unknown) => ({ op: "asc", col })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
}));

// Import after mocks are in place
import { computeHashFromRows, recordDailyIntegrity, verifyIntegrity } from "../lib/audit-integrity";
import { db } from "@workspace/db";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeRow(overrides: Partial<{
  id: number; userId: number | null; clinicId: number | null;
  action: string; entityType: string | null; entityId: string | null; createdAt: Date;
}> = {}) {
  return {
    id: 1,
    userId: 10,
    clinicId: 1,
    action: "READ",
    entityType: "patient",
    entityId: "42",
    createdAt: new Date("2026-01-15T09:00:00.000Z"),
    ...overrides,
  };
}

function setupSelectChain(results: unknown[][]) {
  // Each call to db.select returns a chain: .from().where().orderBy().limit()
  // We track the call index so successive calls return different results.
  let callIdx = 0;
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const data = results[callIdx++] ?? [];
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(data),
    };
    // Without .limit() the chain itself should resolve (for unbounded queries)
    Object.assign(chain, { then: (resolve: (v: unknown) => void) => Promise.resolve(data).then(resolve) });
    return chain;
  });
}

function setupInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });
  return { values, onConflictDoUpdate };
}

function setupUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set });
  return { set, where };
}

// â”€â”€ computeHashFromRows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("computeHashFromRows", () => {
  it("returns a deterministic 64-char hex string for an empty row set", () => {
    const h1 = computeHashFromRows([], "genesis");
    const h2 = computeHashFromRows([], "genesis");
    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different prevHash inputs", () => {
    const h1 = computeHashFromRows([], "genesis");
    const h2 = computeHashFromRows([], "different");
    expect(h1).not.toBe(h2);
  });

  it("is order-sensitive â€” same rows in different order yield different hashes", () => {
    const r1 = makeRow({ id: 1 });
    const r2 = makeRow({ id: 2 });
    const h1 = computeHashFromRows([r1, r2], "genesis");
    const h2 = computeHashFromRows([r2, r1], "genesis");
    expect(h1).not.toBe(h2);
  });

  it("handles null userId, clinicId, entityType, entityId without throwing", () => {
    const r = makeRow({ userId: null, clinicId: null, entityType: null, entityId: null });
    expect(() => computeHashFromRows([r], "genesis")).not.toThrow();
  });

  it("chains multiple rows deterministically", () => {
    const rows = [makeRow({ id: 1 }), makeRow({ id: 2, action: "UPDATE" })];
    const h1 = computeHashFromRows(rows, "abc");
    const h2 = computeHashFromRows(rows, "abc");
    expect(h1).toBe(h2);
  });
});

// â”€â”€ recordDailyIntegrity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("recordDailyIntegrity", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("inserts with status='ok' when rows exist", async () => {
    const prevRecord = [{ rootHash: "prevhash123" }];
    const auditRows = [makeRow({ id: 1 }), makeRow({ id: 2 })];
    setupSelectChain([prevRecord, auditRows]);
    const { onConflictDoUpdate, values } = setupInsertChain();

    await recordDailyIntegrity(new Date("2026-01-15T00:00:00.000Z"));

    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertArg = (values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.checkedDate).toBe("2026-01-15");
    expect(insertArg.rowCount).toBe(2);
    expect(insertArg.prevHash).toBe("prevhash123");
    expect(insertArg.status).toBe("ok");
    expect(insertArg.rootHash).toHaveLength(64);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("inserts with status='empty' when no rows found", async () => {
    setupSelectChain([[{ rootHash: "prevhash" }], []]);
    const { values } = setupInsertChain();

    await recordDailyIntegrity(new Date("2026-01-15T00:00:00.000Z"));

    const insertArg = (values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.status).toBe("empty");
    expect(insertArg.rowCount).toBe(0);
  });

  it("uses prevHash='genesis' when no previous record exists", async () => {
    setupSelectChain([[], [makeRow()]]);
    const { values } = setupInsertChain();

    await recordDailyIntegrity(new Date("2026-01-15T00:00:00.000Z"));

    const insertArg = (values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.prevHash).toBe("genesis");
  });

  it("defaults date to yesterday UTC when omitted", async () => {
    setupSelectChain([[], []]);
    const { values } = setupInsertChain();

    const before = new Date();
    before.setUTCDate(before.getUTCDate() - 1);
    const expectedDate = before.toISOString().slice(0, 10);

    await recordDailyIntegrity(); // no argument

    const insertArg = (values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.checkedDate).toBe(expectedDate);
  });

  it("produces a stable rootHash for the same inputs", async () => {
    const row = makeRow({ id: 99 });
    setupSelectChain([[{ rootHash: "stablePrev" }], [row]]);
    const { values: vals1 } = setupInsertChain();
    await recordDailyIntegrity(new Date("2026-01-15T00:00:00.000Z"));
    const hash1 = (vals1 as ReturnType<typeof vi.fn>).mock.calls[0][0].rootHash;

    vi.clearAllMocks();
    setupSelectChain([[{ rootHash: "stablePrev" }], [row]]);
    const { values: vals2 } = setupInsertChain();
    await recordDailyIntegrity(new Date("2026-01-15T00:00:00.000Z"));
    const hash2 = (vals2 as ReturnType<typeof vi.fn>).mock.calls[0][0].rootHash;

    expect(hash1).toBe(hash2);
  });
});

// â”€â”€ verifyIntegrity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("verifyIntegrity", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns ok=true and updates verifiedAt when hash matches", async () => {
    const row = makeRow({ id: 1 });
    const expectedHash = computeHashFromRows([row], "knownPrev");
    const storedRecord = [{
      checkedDate: "2026-01-15",
      rootHash: expectedHash,
      prevHash: "knownPrev",
      rowCount: 1,
      status: "ok" as const,
      verifiedAt: null,
      id: 1,
      createdAt: new Date(),
    }];
    setupSelectChain([storedRecord, [row]]);
    setupUpdateChain();

    const result = await verifyIntegrity(new Date("2026-01-15T00:00:00.000Z"));

    expect(result.ok).toBe(true);
    expect(result.stored).toBe(expectedHash);
    expect(result.computed).toBe(expectedHash);
    expect(mockIncrement).not.toHaveBeenCalled();
  });

  it("returns ok=false, increments counter, and updates status=mismatch on hash mismatch", async () => {
    const row = makeRow({ id: 1 });
    const storedRecord = [{
      checkedDate: "2026-01-15",
      rootHash: "tampered_hash_that_wont_match",
      prevHash: "knownPrev",
      rowCount: 1,
      status: "ok" as const,
      verifiedAt: null,
      id: 1,
      createdAt: new Date(),
    }];
    setupSelectChain([storedRecord, [row]]);
    const { set } = setupUpdateChain();

    const result = await verifyIntegrity(new Date("2026-01-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    expect(result.stored).toBe("tampered_hash_that_wont_match");
    expect(mockIncrement).toHaveBeenCalledTimes(1);
    const updateArg = (set as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArg.status).toBe("mismatch");
  });

  it("throws when no stored record exists for the date", async () => {
    setupSelectChain([[]]);

    await expect(verifyIntegrity(new Date("2026-01-15T00:00:00.000Z")))
      .rejects
      .toThrow("No audit integrity record for 2026-01-15");
  });
});
