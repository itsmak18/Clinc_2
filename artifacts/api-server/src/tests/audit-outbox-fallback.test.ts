/**
 * Unit tests for lib/audit-outbox-fallback.ts — durable fallback for the
 * general audit-outbox write path (AUD-SEAM-01).
 *
 * Three invariants under test:
 *   1. appendAuditOutboxFallback writes a JSONL line + increments the
 *      fallback counter; never throws even if the fs write itself fails
 *      (increments the write-failures counter instead).
 *   2. reconcileAuditOutboxFallback re-inserts sink rows into audit_outbox
 *      (NOT audit_logs — distinct from break-glass-audit.ts) and truncates
 *      the sink on success.
 *   3. Both empty-file and missing-file states are no-ops, never throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted before all imports) ───────────────────────────────────────

vi.mock("@workspace/db", () => {
  const insertChain = { values: vi.fn().mockResolvedValue([]) };
  const db = { insert: vi.fn().mockReturnValue(insertChain) };
  return { db, auditOutboxTable: {} };
});

// fs mock: provide both `default` (used by `import fs from "fs"`) and named exports.
vi.mock("fs", () => {
  const fns = {
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
    writeFileSync: vi.fn(),
  };
  return { default: fns, ...fns };
});

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../lib/metrics", () => ({
  auditOutboxFallbackTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  auditOutboxFallbackWriteFailuresTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  auditOutboxFallbackPendingGauge: { set: vi.fn() },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { appendAuditOutboxFallback, reconcileAuditOutboxFallback } from "../lib/audit-outbox-fallback";
import { db } from "@workspace/db";
import fs from "fs";
import { auditOutboxFallbackTotal, auditOutboxFallbackWriteFailuresTotal } from "../lib/metrics";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sampleRow() {
  return {
    clinicId: 1, userId: 3, action: "UPDATE",
    entityType: "invoice", entityId: "12",
    ipAddress: "127.0.0.1", userAgent: null, details: null,
    beforeState: null, afterState: null, requestId: "req-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const values = vi.fn().mockResolvedValue([]);
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });
  (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("");
});

// ── appendAuditOutboxFallback ─────────────────────────────────────────────────

describe("appendAuditOutboxFallback — write succeeds", () => {
  it("appends a JSONL line and increments the fallback counter", () => {
    appendAuditOutboxFallback(sampleRow(), "UPDATE", "invoice");

    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const [, content] = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const parsed = JSON.parse(content.trim());
    expect(parsed.action).toBe("UPDATE");
    expect(parsed.entityType).toBe("invoice");
    expect(auditOutboxFallbackTotal.labels).toHaveBeenCalledWith("UPDATE", "invoice");
    expect(auditOutboxFallbackWriteFailuresTotal.labels).not.toHaveBeenCalled();
  });

  it("does not throw", () => {
    expect(() => appendAuditOutboxFallback(sampleRow(), "READ", "patient")).not.toThrow();
  });
});

describe("appendAuditOutboxFallback — fs write fails", () => {
  it("increments the write-failures counter and does not throw", () => {
    (fs.appendFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("Disk full");
    });

    expect(() => appendAuditOutboxFallback(sampleRow(), "DELETE", "prescription")).not.toThrow();
    expect(auditOutboxFallbackWriteFailuresTotal.labels).toHaveBeenCalledWith("DELETE", "prescription");
    // appendFileSync threw, so the line that increments the success counter
    // (after the write) never ran — only the write-failures counter fires.
    expect(auditOutboxFallbackTotal.labels).not.toHaveBeenCalled();
  });
});

// ── reconcileAuditOutboxFallback ──────────────────────────────────────────────

describe("reconcileAuditOutboxFallback", () => {
  it("returns {inserted:0} when the fallback file does not exist", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await reconcileAuditOutboxFallback();
    expect(result.inserted).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns {inserted:0} when the file is empty", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("");
    const result = await reconcileAuditOutboxFallback();
    expect(result.inserted).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserts rows into audit_outbox (not audit_logs) and truncates the sink", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(sampleRow()) + "\n");

    const result = await reconcileAuditOutboxFallback();

    expect(result.inserted).toBe(1);
    expect(result.parseErrors).toBe(0);
    expect(db.insert).toHaveBeenCalledTimes(1);
    // The mocked @workspace/db module only exports auditOutboxTable — if the
    // implementation ever imports/inserts into auditLogsTable instead this
    // mock has no such export and the call would throw, failing this test.
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1); // truncate
  });

  it("counts malformed lines as parseErrors without failing the whole reconcile", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      `${JSON.stringify(sampleRow())}\nnot-json\n`,
    );

    const result = await reconcileAuditOutboxFallback();
    expect(result.inserted).toBe(1);
    expect(result.parseErrors).toBe(1);
  });

  it("never throws even if db.insert rejects", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(sampleRow()) + "\n");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    });

    await expect(reconcileAuditOutboxFallback()).resolves.toMatchObject({ inserted: 0 });
    expect(fs.writeFileSync).not.toHaveBeenCalled(); // sink NOT truncated — rows must survive to retry
  });
});
