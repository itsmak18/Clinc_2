import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import type { Request } from "express";
import { logger } from "./logger";
import { auditLogWriteFailuresTotal } from "./metrics";

export async function logRead(req: Request, entityType: string, entityId?: number) {
  return logAudit(req, "READ", entityType, entityId);
}

export async function logDenied(req: Request, entityType: string, entityId: number, reason: string) {
  return logAudit(req, "DENIED", entityType, entityId, { reason });
}

export async function logAudit(req: Request, action: string, entityType: string, entityId?: number, details?: object) {
  const userId = (req as any).user?.userId;
  if (!userId) return;
  try {
    await db.insert(auditLogsTable).values({
      userId,
      action,
      entityType,
      entityId: entityId ?? null,
      ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"] || null,
      details: details ?? null,
      requestId: req.id != null ? String(req.id) : null,
    });
  } catch (err) {
    // Policy: fire-and-forget — the PHI read must not be blocked by an audit-DB hiccup.
    // Failure is observable: counter + structured Pino error. Alert in Prometheus:
    //   increase(audit_log_write_failures_total[5m]) > 0
    auditLogWriteFailuresTotal.labels(action, entityType).inc();
    logger.error(
      { err, action, entityType, entityId, userId, requestId: req.id != null ? String(req.id) : null },
      "audit_write_failed",
    );
  }
}
