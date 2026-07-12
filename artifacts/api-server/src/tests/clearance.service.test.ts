/**
 * Clearance gate (ADR-011) — unit surface.
 *
 * Covers the pure/flag-gated paths that don't need a real database:
 *  - flag OFF: the override endpoint (control plane) refuses with
 *    CLEARANCE_GATE_DISABLED (3021), while the expiry sweep (data plane)
 *    still runs — pending rows from a flag-ON period must drain after a
 *    rollback flips the flag off;
 *  - flag ON: override reason validation (≥30 chars) and invoice-not-found.
 *
 * The full order→basket→pay→flip loop, the workflow guard (3020), cancel,
 * expiry, the basket-uniqueness race, and RLS isolation run against real
 * Postgres in clearance-gate.integration-db.test.ts. Flag-OFF byte-identical
 * behavior is additionally proven by the entire pre-existing suite, which runs
 * with CLEARANCE_GATE_ENABLED unset.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig = vi.hoisted(() => ({
  clearanceGateEnabled: false,
  clearanceTtlHours: 48,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../lib/config", () => ({ config: mockConfig }));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn(),
  logRead: vi.fn(),
  auditSnapshot: (x: unknown) => x,
  SYSTEM_CLINIC_ID: 1,
  SYSTEM_USER_ID: -1,
}));

vi.mock("@workspace/db", () => {
  const __m: any = {
    db: mockDb,
    dbUnsafe: mockDb,
    runInTenantContext: vi.fn().mockImplementation((_user: any, fn: any) => fn(mockDb)),
    invoicesTable: { id: "id", clinicId: "clinicId", patientId: "patientId", kind: "kind", status: "status", deletedAt: "deletedAt", subtotal: "subtotal", discount: "discount", total: "total", updatedAt: "updatedAt", notes: "notes" },
    invoiceItemsTable: { id: "id", clinicId: "clinicId", invoiceId: "invoiceId", quantity: "quantity", unitPrice: "unitPrice" },
    labTestsTable: { id: "id", clinicId: "clinicId", clearanceStatus: "clearanceStatus", invoiceItemId: "invoiceItemId", createdAt: "createdAt", deletedAt: "deletedAt", updatedAt: "updatedAt" },
    xrayRecordsTable: { id: "id", clinicId: "clinicId", clearanceStatus: "clearanceStatus", invoiceItemId: "invoiceItemId", createdAt: "createdAt", deletedAt: "deletedAt", updatedAt: "updatedAt" },
    ultrasoundRecordsTable: { id: "id", clinicId: "clinicId", clearanceStatus: "clearanceStatus", invoiceItemId: "invoiceItemId", createdAt: "createdAt", deletedAt: "deletedAt", updatedAt: "updatedAt" },
    clinicInvoiceCountersTable: { clinicId: "clinicId", lastSeq: "lastSeq" },
    servicesCatalogTable: { id: "id", clinicId: "clinicId", code: "code", active: "active", deletedAt: "deletedAt", defaultPrice: "defaultPrice" },
    auditOutboxTable: {},
  };
  return __m;
});

import { overrideInvoiceClearance, expirePendingClearances, parseClearanceStatusFilter, orderChargeFromLine } from "../modules/billing/clearance.service";

const fakeReq = { user: { userId: 7, username: "dr", role: "doctor", clinicId: 3 }, headers: {} } as any;
const LONG_REASON = "Patient in acute respiratory distress — imaging needed before payment.";

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.clearanceGateEnabled = false;
});

describe("clearance gate — flag OFF", () => {
  it("expirePendingClearances (data plane) still sweeps — pending rows must drain after a rollback", async () => {
    // Empty-clinic tx stub: every UPDATE ... RETURNING yields no rows.
    const returningEmpty = { returning: async () => [] };
    const txStub = { update: () => ({ set: () => ({ where: () => returningEmpty }) }) };
    mockDb.transaction.mockImplementation(async (fn: any) => fn(txStub));

    const res = await expirePendingClearances();
    expect(res).toEqual({ expired: 0, basketsCancelled: 0 });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it("overrideInvoiceClearance (control plane) refuses with CLEARANCE_GATE_DISABLED (3021)", async () => {
    await expect(overrideInvoiceClearance(fakeReq, 1, LONG_REASON)).rejects.toMatchObject({
      name: "ClearanceGateDisabledError",
      errorDef: expect.objectContaining({ code: 3021 }),
    });
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe("parseClearanceStatusFilter", () => {
  it("accepts a single value and a comma list", () => {
    expect(parseClearanceStatusFilter("pending")).toEqual(["pending"]);
    expect(parseClearanceStatusFilter("cleared,overridden")).toEqual(["cleared", "overridden"]);
    expect(parseClearanceStatusFilter(" cleared , overridden ")).toEqual(["cleared", "overridden"]);
  });

  it("rejects unknown values and empty filters (400, not silent drop)", () => {
    expect(() => parseClearanceStatusFilter("paidish")).toThrowError(/unknown value/);
    expect(() => parseClearanceStatusFilter("cleared,nope")).toThrowError(/unknown value/);
    expect(() => parseClearanceStatusFilter(",")).toThrowError(/empty/);
  });
});

describe("orderChargeFromLine (visibility plan D1 — own line only)", () => {
  it("computes quantity × unit price in cents", () => {
    expect(orderChargeFromLine(1, "150.00")).toEqual({ amountCents: 15000 });
    expect(orderChargeFromLine(2, "0.30")).toEqual({ amountCents: 60 });
    expect(orderChargeFromLine(1, "0.00")).toEqual({ amountCents: 0 });
  });

  it("returns null for pre-gate rows (no joined line)", () => {
    expect(orderChargeFromLine(null, null)).toBeNull();
    expect(orderChargeFromLine(1, null)).toBeNull();
    expect(orderChargeFromLine(null, "150.00")).toBeNull();
  });
});

describe("overrideInvoiceClearance — flag ON validation", () => {
  beforeEach(() => {
    mockConfig.clearanceGateEnabled = true;
  });

  it("rejects a reason shorter than 30 characters before touching the DB", async () => {
    await expect(overrideInvoiceClearance(fakeReq, 1, "too short")).rejects.toMatchObject({
      name: "ValidationError",
    });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("404s when the invoice does not exist in the caller's clinic", async () => {
    mockDb.select.mockReturnValue({ from: () => ({ where: async () => [] }) });
    await expect(overrideInvoiceClearance(fakeReq, 999, LONG_REASON)).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  it("409s on a manual (non-basket) invoice", async () => {
    mockDb.select.mockReturnValue({
      from: () => ({ where: async () => [{ id: 1, kind: "manual", status: "pending" }] }),
    });
    await expect(overrideInvoiceClearance(fakeReq, 1, LONG_REASON)).rejects.toMatchObject({
      name: "ConflictError",
    });
  });

  it("409s on an already-settled basket", async () => {
    mockDb.select.mockReturnValue({
      from: () => ({ where: async () => [{ id: 1, kind: "order_basket", status: "paid" }] }),
    });
    await expect(overrideInvoiceClearance(fakeReq, 1, LONG_REASON)).rejects.toMatchObject({
      name: "ConflictError",
    });
  });
});
