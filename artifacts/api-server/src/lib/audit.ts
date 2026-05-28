import { db } from "@workspace/db";
import { auditLogsTable, auditOutboxTable } from "@workspace/db";
import { and, lt, or, isNull, lte, eq } from "drizzle-orm";
import type { Request } from "express";
import { logger } from "./logger";
import { auditLogWriteFailuresTotal, auditOutboxDepthGauge } from "./metrics";

export async function logRead(req: Request, entityType: string, entityId?: number) {
  return logAudit(req, "READ", entityType, entityId);
}

export async function logDenied(req: Request, entityType: string, entityId: number, reason: string) {
  return logAudit(req, "DENIED", entityType, entityId, { reason });
}

export async function logAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId?: number,
  details?: object | null,
  beforeState?: object | null,
  afterState?: object | null,
) {
  const userId = (req as any).user?.userId as number | undefined;
  if (!userId) return;
  try {
    await db.insert(auditOutboxTable).values({
      userId,
      action,
      entityType,
      entityId: entityId ?? null,
      ipAddress: req.ip || (req.socket as any)?.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"] || null,
      details: details ?? null,
      beforeState: beforeState ?? null,
      afterState: afterState ?? null,
      requestId: req.id != null ? String(req.id) : null,
    });
  } catch (err) {
    // Outbox insert failed — the audit event is lost. Count it and log.
    auditLogWriteFailuresTotal.labels(action, entityType).inc();
    logger.error(
      { err, action, entityType, entityId, userId, requestId: req.id != null ? String(req.id) : null },
      "audit_outbox_write_failed",
    );
  }
}

// Exponential backoff delays per attempt index (0-based): 5s, 30s, 2m, 10m
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000] as const;
const MAX_ATTEMPTS = 5;
const DRAIN_BATCH = 100;

/**
 * Transfer up to DRAIN_BATCH ready rows from audit_outbox → audit_logs.
 * Called on a 5-second interval by the drain worker in cron.ts.
 * Also called once during graceful shutdown before the pool closes.
 */
export async function drainAuditOutbox(): Promise<void> {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(auditOutboxTable)
      .where(
        and(
          lt(auditOutboxTable.attempts, MAX_ATTEMPTS),
          or(
            isNull(auditOutboxTable.nextAttemptAt),
            lte(auditOutboxTable.nextAttemptAt, now),
          ),
        ),
      )
      .limit(DRAIN_BATCH)
      .orderBy(auditOutboxTable.id);

    auditOutboxDepthGauge.set(rows.length);
    if (rows.length === 0) return;

    for (const row of rows) {
      try {
        await db.insert(auditLogsTable).values({
          clinicId: row.clinicId,
          userId: row.userId ?? undefined,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId ?? null,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent ?? null,
          details: row.details ?? null,
          beforeState: row.beforeState ?? null,
          afterState: row.afterState ?? null,
          requestId: row.requestId ?? null,
        });
        await db.delete(auditOutboxTable).where(eq(auditOutboxTable.id, row.id));
      } catch (err) {
        const nextAttempts = row.attempts + 1;
        const backoffMs = BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)];
        const nextAttemptAt = new Date(Date.now() + backoffMs);
        await db
          .update(auditOutboxTable)
          .set({ attempts: nextAttempts, nextAttemptAt })
          .where(eq(auditOutboxTable.id, row.id))
          .catch((updateErr) => {
            logger.error({ updateErr, rowId: row.id }, "audit_outbox_update_failed");
          });
        if (nextAttempts >= MAX_ATTEMPTS) {
          auditLogWriteFailuresTotal.labels(row.action, row.entityType).inc();
          logger.error(
            { err, rowId: row.id, action: row.action, entityType: row.entityType, attempts: nextAttempts },
            "audit_outbox_row_exhausted",
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "audit_outbox_drain_failed");
  }
}
