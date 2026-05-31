/**
 * audit.failure.test.ts
 *
 * Verifies the audit outbox failure-path policy: fire-and-forget with
 * observability. When the outbox insert rejects, the caller must NOT throw, the
 * Prometheus counter `audit_log_write_failures_total` must increment, and Pino
 * must emit a structured `audit_outbox_write_failed` error log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertMock, loggerErrorMock, loggerWarnMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { insert: () => ({ values: insertMock }) },
  auditOutboxTable: {},
}));

vi.mock("../lib/logger", () => ({
  logger: { error: loggerErrorMock, info: vi.fn(), warn: loggerWarnMock, debug: vi.fn() },
}));

import { logAudit, SYSTEM_USER_ID, SYSTEM_CLINIC_ID } from "../lib/audit";
import { auditLogWriteFailuresTotal, auditSystemActorTotal } from "../lib/metrics";

function fakeReq() {
  return {
    user: { userId: 42, role: "doctor" },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "user-agent": "vitest" },
    id: "req-abc",
  } as any;
}

async function counterValue(action: string, entity_type: string): Promise<number> {
  const m = await auditLogWriteFailuresTotal.get();
  const v = m.values.find(x => x.labels.action === action && x.labels.entity_type === entity_type);
  return v ? v.value : 0;
}

describe("logAudit — fire-and-forget on DB failure", () => {
  beforeEach(() => {
    insertMock.mockReset();
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it("does not throw when the audit insert rejects", async () => {
    insertMock.mockRejectedValueOnce(new Error("connection refused"));
    await expect(logAudit(fakeReq(), "READ", "patient", 7)).resolves.toBeUndefined();
  });

  it("increments audit_log_write_failures_total on failure", async () => {
    const before = await counterValue("READ", "lab_test");
    insertMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await logAudit(fakeReq(), "READ", "lab_test", 99);
    const after = await counterValue("READ", "lab_test");
    expect(after).toBe(before + 1);
  });

  it("logs a structured audit_write_failed event at error level", async () => {
    insertMock.mockRejectedValueOnce(new Error("disk full"));
    await logAudit(fakeReq(), "UPDATE", "invoice", 12);
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    const [ctx, msg] = loggerErrorMock.mock.calls[0];
    expect(msg).toBe("audit_outbox_write_failed");
    expect(ctx).toMatchObject({
      action: "UPDATE",
      entityType: "invoice",
      entityId: 12,
      userId: 42,
      requestId: "req-abc",
    });
    expect(ctx.err).toBeInstanceOf(Error);
  });

  it("does NOT log or count when the audit insert succeeds", async () => {
    insertMock.mockResolvedValueOnce(undefined);
    const before = await counterValue("CREATE", "patient");
    await logAudit(fakeReq(), "CREATE", "patient", 1);
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(await counterValue("CREATE", "patient")).toBe(before);
  });

  it("[Phase 3.2] writes a system-actor row when req.user is missing (no longer silent)", async () => {
    insertMock.mockResolvedValueOnce(undefined);
    await logAudit({ headers: {}, socket: {} } as any, "READ", "patient", 5);

    // 1) The insert IS issued — events are no longer silently dropped.
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SYSTEM_USER_ID,
        clinicId: SYSTEM_CLINIC_ID,
        action: "READ",
        entityType: "patient",
        entityId: "5",
      }),
    );

    // 2) A structured warning fires so operators can find the calling path.
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    const [ctx, msg] = loggerWarnMock.mock.calls[0];
    expect(msg).toBe("audit_system_actor_used");
    expect(ctx).toMatchObject({ action: "READ", entityType: "patient", entityId: 5 });

    // 3) The error-path counter does not increment on a successful insert.
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it("[Phase 3.2] increments audit_system_actor_total when req.user is missing", async () => {
    insertMock.mockResolvedValueOnce(undefined);

    const before = (await auditSystemActorTotal.get()).values
      .find(v => v.labels.action === "UPDATE" && v.labels.entity_type === "operation")?.value ?? 0;
    await logAudit({ headers: {}, socket: {} } as any, "UPDATE", "operation", 9);
    const after = (await auditSystemActorTotal.get()).values
      .find(v => v.labels.action === "UPDATE" && v.labels.entity_type === "operation")?.value ?? 0;

    expect(after).toBe(before + 1);
  });
});
