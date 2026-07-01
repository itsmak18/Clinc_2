import { db } from "@workspace/db";
import { auditLogsTable, auditOutboxTable } from "@workspace/db";
import { and, lt, or, isNull, lte, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import { logger } from "./logger";
import { auditLogWriteFailuresTotal, auditOutboxDepthGauge, auditSystemActorTotal } from "./metrics";
import { appendAuditOutboxFallback } from "./audit-outbox-fallback";

// Sentinel userId for events emitted without an authenticated request context
// (cron drains, system-initiated retries, internal jobs). Negative values
// can never collide with a real serial-PK users.id. Phase 3.2 (2026-05-31).
export const SYSTEM_USER_ID = -1;
// Sentinel clinicId for system events that have no tenant association. Bypasses
// the `clinic_id > 0` CHECK (0014) on purpose — system audits don't belong to
// any tenant. Using `1` here would silently land system events in clinic 1's
// audit, which is the exact black-hole bug Phase 0 closed in policy.ts.
//
// audit_outbox is intentionally unconstrained (no FK), but audit_logs has FK to
// clinics and CHECK > 0 from migration 0014. Therefore system events live in
// the outbox as-is, but the drain worker writes them with clinic_id = 1 to
// land them in the default clinic's audit (acceptable: system events are
// global by nature; the cross-tenant leak risk that motivated CHECK > 0 is
// not present here because there's no user to leak to).
export const SYSTEM_CLINIC_ID = 1;

export async function logRead(req: Request, entityType: string, entityId?: string | number) {
  return logAudit(req, "READ", entityType, entityId);
}

export async function logDenied(req: Request, entityType: string, entityId: string | number, reason: string) {
  return logAudit(req, "DENIED", entityType, entityId, { reason });
}

/**
 * Build the shared row object used by both the outbox insert (logAudit) and the
 * direct audit_logs insert (auditBreakGlass). Exported so break-glass-audit.ts
 * can reuse the exact same field-building logic without duplication.
 */
export function buildAuditRow(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string | number,
  details?: object | null,
  beforeState?: object | null,
  afterState?: object | null,
) {
  const user = req.user;
  const userId: number = user?.userId ?? SYSTEM_USER_ID;
  const clinicId: number = user?.clinicId ?? SYSTEM_CLINIC_ID;
  return {
    clinicId,
    userId,
    action,
    entityType,
    entityId: entityId != null ? String(entityId) : null,
    ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
    details: details ?? null,
    beforeState: beforeState ?? null,
    afterState: afterState ?? null,
    requestId: req.id != null ? String(req.id) : null,
  };
}

export async function logAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string | number,
  details?: object | null,
  beforeState?: object | null,
  afterState?: object | null,
) {
  // Phase 3.2: instead of silently returning when req.user is absent, route to
  // the system actor so the event is never lost. A sustained non-zero rate of
  // `audit_system_actor_total` indicates a call path that's emitting audit
  // events without an authenticated user — investigate the source.
  const user = req.user;
  if (!user) {
    auditSystemActorTotal.labels(action, entityType).inc();
    logger.warn(
      { action, entityType, entityId, requestId: req.id != null ? String(req.id) : null },
      "audit_system_actor_used",
    );
  }
  // `row` is declared here (not just inside the try) so the catch block can
  // still reach it for the fallback write below — but building it happens
  // INSIDE the try, matching the original behavior: if buildAuditRow itself
  // throws (e.g. a malformed req object missing .headers), that must still be
  // caught here exactly as before, not propagate as an uncaught rejection.
  let row: ReturnType<typeof buildAuditRow> | undefined;
  try {
    row = buildAuditRow(req, action, entityType, entityId, details, beforeState, afterState);
    await db.insert(auditOutboxTable).values(row);
  } catch (err) {
    // Outbox insert failed. Count it, log it, and durably capture the event
    // in the local fallback sink (AUD-SEAM-01) so it is never silently lost —
    // mirrors the break-glass fallback pattern, reconciled back into
    // audit_outbox on a 60s interval (see audit-outbox-fallback.ts). If row
    // construction itself is what threw, there is nothing to persist to the
    // fallback sink (row is undefined) — same no-crash, counted-and-logged
    // outcome as before this change.
    auditLogWriteFailuresTotal.labels(action, entityType).inc();
    logger.error(
      { err, action, entityType, entityId, userId: user?.userId ?? SYSTEM_USER_ID, requestId: req.id != null ? String(req.id) : null },
      "audit_outbox_write_failed",
    );
    if (row) {
      appendAuditOutboxFallback(row, action, entityType);
    }
  }
}

// Change-history snapshot helpers live in a db-free module so they stay unit
// testable without DATABASE_URL. Re-exported here for existing import sites.
export { auditSnapshot, changedFields } from "./audit-snapshot";

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

    try {
      const logsToInsert = rows.map(row => ({
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
      }));
      const rowIds = rows.map(row => row.id);

      // AUD-SEAM-05: insert + delete wrapped in one transaction. Previously
      // these were two independent statements — a crash between them (insert
      // committed, delete never ran) left the same rows in audit_outbox, so
      // the next drain tick re-inserted them into audit_logs as duplicates,
      // corrupting the hash-chain's per-day row count. Now both commit or
      // neither does; a re-drain after a crash is a no-op retry, not a dup.
      await db.transaction(async (tx) => {
        await tx.insert(auditLogsTable).values(logsToInsert);
        await tx.delete(auditOutboxTable).where(inArray(auditOutboxTable.id, rowIds));
      });

      logger.info({ count: rows.length }, "audit_outbox_drain_batch_success");
    } catch (batchErr) {
      // Fallback path: one of the rows failed. Process individually to isolate the issue.
      logger.warn({ batchErr }, "audit_outbox_drain_batch_failed_falling_back");

      for (const row of rows) {
        try {
          // Same atomicity reasoning as the batch path above.
          await db.transaction(async (tx) => {
            await tx.insert(auditLogsTable).values({
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
            await tx.delete(auditOutboxTable).where(eq(auditOutboxTable.id, row.id));
          });
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
    }
  } catch (err) {
    logger.error({ err }, "audit_outbox_drain_failed");
  }
}
