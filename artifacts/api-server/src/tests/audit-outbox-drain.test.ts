/**
 * Unit tests for lib/audit.ts's drainAuditOutbox — AUD-SEAM-05 wiring proof.
 *
 * These confirm the STRUCTURAL fix: the batch insert+delete (and the per-row
 * fallback insert+delete) are now issued inside a single db.transaction()
 * call, not as two independent statements. The actual Postgres rollback
 * guarantee this relies on (does db.transaction really roll back atomically
 * under a real crash?) was already empirically proven against real Postgres
 * by the AUD-DB-05 pooled-connection test last sprint (mid-transaction-throw
 * scenario) — this suite does not re-prove that; see
 * audit-outbox-drain-atomicity.integration-db.test.ts for the real-Postgres,
 * forced-failure proof specific to this drain path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { transactionMock, txInsertValuesMock, txDeleteWhereMock, selectRowsMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  txInsertValuesMock: vi.fn(),
  txDeleteWhereMock: vi.fn(),
  selectRowsMock: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  // Chainable select() → from() → where() → limit() → orderBy() resolving to
  // whatever selectRowsMock() currently returns.
  const chainable = () => {
    const handler: ProxyHandler<unknown[]> = {
      get: (_t, prop) => {
        if (prop === "then") {
          const rows = selectRowsMock();
          return (resolve: (v: unknown) => void) => resolve(rows);
        }
        return () => new Proxy([] as unknown[], handler);
      },
    };
    return new Proxy([] as unknown[], handler);
  };

  return {
    db: {
      select: vi.fn(() => chainable()),
      transaction: transactionMock,
    },
    auditLogsTable: {},
    auditOutboxTable: { id: "id" },
  };
});

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../lib/metrics", () => ({
  auditLogWriteFailuresTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  auditOutboxDepthGauge: { set: vi.fn() },
  auditSystemActorTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));

vi.mock("../lib/audit-outbox-fallback", () => ({
  appendAuditOutboxFallback: vi.fn(),
}));

import { drainAuditOutbox } from "../lib/audit";

function fakeTx() {
  return {
    insert: vi.fn(() => ({ values: txInsertValuesMock })),
    delete: vi.fn(() => ({ where: txDeleteWhereMock })),
    update: vi.fn(() => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) })),
  };
}

function outboxRow(id: number) {
  return {
    id, clinicId: 1, userId: 3, action: "UPDATE", entityType: "invoice",
    entityId: "12", ipAddress: "127.0.0.1", userAgent: null, details: null,
    beforeState: null, afterState: null, requestId: null, attempts: 0, nextAttemptAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txInsertValuesMock.mockResolvedValue(undefined);
  txDeleteWhereMock.mockResolvedValue(undefined);
  selectRowsMock.mockReturnValue([]);
  transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx()));
});

describe("drainAuditOutbox — AUD-SEAM-05 (batch path)", () => {
  it("does nothing (no transaction) when there are no pending rows", async () => {
    selectRowsMock.mockReturnValue([]);
    await drainAuditOutbox();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("wraps the batch insert+delete in exactly one db.transaction call", async () => {
    selectRowsMock.mockReturnValue([outboxRow(1), outboxRow(2)]);
    await drainAuditOutbox();

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txInsertValuesMock).toHaveBeenCalledTimes(1);
    expect(txDeleteWhereMock).toHaveBeenCalledTimes(1);
  });
});

describe("drainAuditOutbox — AUD-SEAM-05 (per-row fallback path)", () => {
  it("falls back to one db.transaction PER ROW when the batch transaction rejects", async () => {
    selectRowsMock.mockReturnValue([outboxRow(1), outboxRow(2)]);

    let call = 0;
    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      call++;
      if (call === 1) throw new Error("simulated batch failure"); // the batch attempt
      return cb(fakeTx()); // subsequent per-row attempts succeed
    });

    await drainAuditOutbox();

    // 1 failed batch attempt + 2 per-row attempts (one per outbox row) = 3.
    expect(transactionMock).toHaveBeenCalledTimes(3);
  });

  it("a per-row transaction failure does not throw out of drainAuditOutbox (fire-and-forget)", async () => {
    selectRowsMock.mockReturnValue([outboxRow(1)]);
    transactionMock.mockRejectedValue(new Error("always fails"));

    await expect(drainAuditOutbox()).resolves.toBeUndefined();
  });
});
