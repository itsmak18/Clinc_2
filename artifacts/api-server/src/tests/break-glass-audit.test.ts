/**
 * Unit tests for lib/break-glass-audit.ts — durable audit path.
 *
 * Three invariants under test:
 *   1. Primary success  → audit_logs insert called; fallback never touched.
 *   2. Primary fail     → fallback sink written; fallback counter incremented; no throw.
 *   3. Both fail        → failures counter incremented; no throw (access proceeds).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request } from "express";

// ── Mocks (hoisted before all imports) ───────────────────────────────────────

vi.mock("@workspace/db", () => {
  const insertChain = { values: vi.fn().mockResolvedValue([]) };
  const db = { insert: vi.fn().mockReturnValue(insertChain) };
  return { db, auditLogsTable: {} };
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

vi.mock("../lib/audit-integrity", () => ({
  recordDailyIntegrity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../lib/metrics", () => ({
  breakGlassAuditFallbackTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  breakGlassAuditFailuresTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  breakGlassAuditFallbackPendingGauge: { set: vi.fn() },
}));

vi.mock("../lib/audit", () => ({
  buildAuditRow: vi.fn().mockReturnValue({
    clinicId: 1, userId: 3, action: "BREAK_GLASS_ACCESS",
    entityType: "lab_test", entityId: "42",
    ipAddress: "127.0.0.1", userAgent: null, details: null,
    beforeState: null, afterState: null, requestId: "req-1",
  }),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { auditBreakGlass, reconcileBreakGlassAuditFallback } from "../lib/break-glass-audit";
import { db } from "@workspace/db";
import fs from "fs";
import { breakGlassAuditFallbackTotal, breakGlassAuditFailuresTotal } from "../lib/metrics";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockReq(): Request {
  return {
    user: { userId: 3, clinicId: 1, role: "doctor" },
    ip: "127.0.0.1",
    headers: {},
    socket: {},
    id: "req-1",
  } as unknown as Request;
}

function dbInsertValues() {
  return (db.insert as ReturnType<typeof vi.fn>)().values as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-wire the chain after clearAllMocks
  const values = vi.fn().mockResolvedValue([]);
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values });
});

// ── auditBreakGlass ───────────────────────────────────────────────────────────

describe("auditBreakGlass — primary success", () => {
  it("inserts directly into audit_logs and returns without touching fs", async () => {
    await auditBreakGlass(mockReq(), "BREAK_GLASS_ACTIVATED", "break_glass_session", 7);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    expect(breakGlassAuditFallbackTotal.labels).not.toHaveBeenCalled();
    expect(breakGlassAuditFailuresTotal.labels).not.toHaveBeenCalled();
  });
});

describe("auditBreakGlass — primary fails, fallback succeeds", () => {
  it("writes to JSONL sink, increments fallback counter, does not throw", async () => {
    // Make audit_logs insert fail
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    });

    await expect(
      auditBreakGlass(mockReq(), "BREAK_GLASS_ACCESS", "lab_test", 42),
    ).resolves.toBeUndefined();

    expect(breakGlassAuditFallbackTotal.labels).toHaveBeenCalledWith("BREAK_GLASS_ACCESS");
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const [, content] = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const parsed = JSON.parse(content.trim());
    expect(parsed.action).toBe("BREAK_GLASS_ACCESS");
    expect(parsed.createdAt).toBeDefined();
    expect(breakGlassAuditFailuresTotal.labels).not.toHaveBeenCalled();
  });
});

describe("auditBreakGlass — primary fails AND fallback fails", () => {
  it("increments failures counter and does not throw", async () => {
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    });
    (fs.appendFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("Disk full");
    });

    await expect(
      auditBreakGlass(mockReq(), "BREAK_GLASS_ACTIVATED", "break_glass_session", 5),
    ).resolves.toBeUndefined();

    expect(breakGlassAuditFallbackTotal.labels).toHaveBeenCalledTimes(1);
    expect(breakGlassAuditFailuresTotal.labels).toHaveBeenCalledWith("BREAK_GLASS_ACTIVATED");
  });
});

// ── reconcileBreakGlassAuditFallback ────────────────────────────────────────

describe("reconcileBreakGlassAuditFallback", () => {
  it("returns {inserted:0} when fallback file does not exist", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await reconcileBreakGlassAuditFallback();
    expect(result.inserted).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns {inserted:0} when file is empty", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("");
    const result = await reconcileBreakGlassAuditFallback();
    expect(result.inserted).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserts rows, truncates file, and re-records hash for affected dates", async () => {
    const { recordDailyIntegrity } = await import("../lib/audit-integrity");
    const row = {
      clinicId: 1, userId: 3, action: "BREAK_GLASS_ACCESS",
      entityType: "lab_test", entityId: "42",
      ipAddress: "127.0.0.1", userAgent: null, details: null,
      beforeState: null, afterState: null, requestId: null,
      createdAt: "2026-06-27T10:00:00.000Z",
    };

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(row) + "\n");

    const result = await reconcileBreakGlassAuditFallback();

    expect(result.inserted).toBe(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1); // truncate
    expect(recordDailyIntegrity).toHaveBeenCalledTimes(1);
  });
});
