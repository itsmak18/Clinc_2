import cron, { type ScheduledTask } from "node-cron";
import { db, pool } from "@workspace/db";
import { appointmentsTable, auditLogsTable, patientsTable, erasureRequestsTable } from "@workspace/db";
import { eq, and, lte, isNull, lt, sql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { validateTransition } from "./lib/appointment-state-machine";
import { emitToUser } from "./lib/sse";
import { usersTable } from "@workspace/db";
import type { AppointmentStatus } from "./lib/appointment-state-machine";
import type { Request } from "express";
import { drainAuditOutbox, logAudit } from "./lib/audit";
import { recordDailyIntegrity, verifyRecentIntegrity, verifyChainLinkage } from "./lib/audit-integrity";
import { auditPartitionMonthsRemainingGauge } from "./lib/metrics";

// Tracks every cron task so the graceful-shutdown path can stop them before
// the DB pool is drained (H7). Without this, an in-flight cron callback could
// fire a write against a closed pool and crash the process post-server-close.
const scheduledTasks: ScheduledTask[] = [];

let drainInterval: ReturnType<typeof setInterval> | null = null;

/** Start the 5-second audit-outbox drain loop. Idempotent. */
export function startAuditDrain(): void {
  if (drainInterval) return;
  drainInterval = setInterval(() => { void drainAuditOutbox(); }, 5_000);
  // unref so the interval doesn't prevent process exit if everything else closes
  drainInterval.unref();
  logger.info("Audit outbox drain started (5s interval)");
}

/** Stop the audit-outbox drain loop. Idempotent. */
export function stopAuditDrain(): void {
  if (!drainInterval) return;
  clearInterval(drainInterval);
  drainInterval = null;
  logger.info("Audit outbox drain stopped");
}

// Start cron jobs
export function startCronJobs() {
  logger.info("Starting background cron jobs...");

  // Data Retention Report (runs 1st of every month at 03:00)
  // Reports on audit logs older than 7 years and soft-deleted patients pending erasure.
  // No hard deletion — per ADR-005, that requires a manual compliance officer override.
  scheduledTasks.push(cron.schedule("0 3 1 * *", async () => {
    logger.info("[Cron] Running Data Retention Report");
    try {
      const sevenYearsAgo = new Date();
      sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

      const [auditOverdue] = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogsTable)
        .where(lt(auditLogsTable.createdAt, sevenYearsAgo));

      const [pendingErasure] = await db
        .select({ count: sql<number>`count(*)` })
        .from(patientsTable)
        .where(and(
          lte(patientsTable.deletedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
          // Deleted more than 30 days ago and no executed erasure request
        ));

      const [openErasureRequests] = await db
        .select({ count: sql<number>`count(*)` })
        .from(erasureRequestsTable)
        .where(eq(erasureRequestsTable.status, "pending"));

      const overdueAuditCount = Number(auditOverdue?.count ?? 0);
      const pendingErasureCount = Number(pendingErasure?.count ?? 0);
      const openRequestCount = Number(openErasureRequests?.count ?? 0);

      logger.info({
        overdueAuditLogs: overdueAuditCount,
        softDeletedPatientsOverThirtyDays: pendingErasureCount,
        openErasureRequests: openRequestCount,
      }, "[Cron] Data Retention Report");

      if (overdueAuditCount > 0 || openRequestCount > 0) {
        const officers = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.role, "compliance_officer"));

        for (const officer of officers) {
          emitToUser(officer.id, "retention_report", {
            overdueAuditLogs: overdueAuditCount,
            openErasureRequests: openRequestCount,
          });
        }
      }

      // Audit partition headroom check — counts future monthly partitions so
      // operators can extend the horizon before rows spill into the DEFAULT
      // catch-all. Only meaningful after migration 0021 ships; no-ops on older
      // schemas (pg_class query returns 0, which still sets the gauge).
      try {
        const headroom = await pool.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM pg_class c
           JOIN pg_inherits i ON c.oid = i.inhrelid
           JOIN pg_class p ON i.inhparent = p.oid
           WHERE p.relname = 'audit_logs'
             AND c.relname ~ '^audit_logs_part_[0-9]{4}_[0-9]{2}$'
             AND c.relname >= concat('audit_logs_part_', to_char(now(), 'YYYY_MM'))`
        );
        const monthsRemaining = headroom.rows[0]?.count ?? 0;
        auditPartitionMonthsRemainingGauge.set(monthsRemaining);
        logger.info({ monthsRemaining }, "[Cron] Audit partition headroom");
      } catch (partErr) {
        logger.warn({ err: partErr }, "[Cron] Audit partition headroom check failed (non-fatal)");
      }
    } catch (err) {
      logger.error({ err }, "[Cron] Data Retention Report failed");
    }
  }));

  // Audit Integrity Check (runs daily at 02:00 UTC)
  // 1. Records a SHA-256 hash chain over the previous day's audit_log rows.
  // 2. Re-verifies a rolling window of recent days (re-derives each day's hash
  //    from the current rows and compares) so tampering is caught daily, not
  //    only at the quarterly restore drill (F-P4-1).
  // 3. Walks the stored chain asserting each prevHash == prior day's rootHash
  //    (F-P4-2). Any mismatch increments audit_integrity_check_failures_total →
  //    the AuditIntegrityMismatch Prometheus alert fires.
  scheduledTasks.push(cron.schedule("0 2 * * *", async () => {
    logger.info("[Cron] Running Audit Integrity Hash");
    try {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      await recordDailyIntegrity(yesterday);

      const recent = await verifyRecentIntegrity();
      const linkage = await verifyChainLinkage();
      logger.info({ recent, linkage }, "[Cron] Audit integrity verification complete");
      if (recent.mismatches > 0 || linkage.breaks > 0) {
        logger.error(
          { recent, linkage },
          "[Cron] AUDIT INTEGRITY MISMATCH — audit_logs may have been tampered with",
        );
      }
    } catch (err) {
      logger.error({ err }, "[Cron] Audit Integrity Hash failed");
    }
  }));

  // No-show Auto-Transition (runs every hour)
  // Marks appointments as 'no_show' if they are 'scheduled' and the time has passed by >2 hours.
  // Routes through validateTransition so any future state machine changes are respected.
  scheduledTasks.push(cron.schedule("0 * * * *", async () => {
    logger.info("[Cron] Running No-show Auto-Transition job");
    try {
      const fromStatus: AppointmentStatus = "scheduled";

      // Guard: ensure this transition is still valid in the state machine before bulk-updating
      const check = validateTransition("no_show", fromStatus, "system");
      if (!check.ok) {
        logger.error({ err: check.error }, "[Cron] State machine rejected no_show transition — fix appointment-state-machine.ts");
        return;
      }

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const result = await db.update(appointmentsTable)
        .set({ status: check.toStatus, updatedAt: new Date() })
        .where(
          and(
            eq(appointmentsTable.status, fromStatus),
            lte(appointmentsTable.scheduledAt, twoHoursAgo),
          ),
        )
        .returning({ id: appointmentsTable.id, clinicId: appointmentsTable.clinicId });

      if (result.length > 0) {
        logger.info({ count: result.length }, "[Cron] Marked appointments as no_show");

        // F-P1-4: this bulk scheduled→no_show transition is a PHI-adjacent
        // mutation with no request context, so it previously left no audit
        // trail (§164.312(b) gap). Record it under the system actor (SYSTEM_USER_ID
        // / SYSTEM_CLINIC_ID via logAudit's no-req fallback). The write is
        // deliberately cross-tenant (the rule is tenant-uniform); the affected
        // appointment ids + their clinics are captured in details for review.
        // One summary entry per run.
        const systemReq = { headers: {} } as unknown as Request;
        await logAudit(
          systemReq,
          "SYSTEM_NO_SHOW",
          "appointment",
          undefined,
          { count: result.length, appointments: result },
        );
      }
    } catch (err) {
      logger.error({ err }, "[Cron] Failed to run No-show Auto-Transition");
    }
  }));
}

/** Stop all scheduled cron tasks. Idempotent — safe to call repeatedly. */
export function stopCronJobs(): void {
  if (scheduledTasks.length === 0) return;
  logger.info({ count: scheduledTasks.length }, "Stopping cron jobs...");
  for (const task of scheduledTasks) {
    try {
      task.stop();
    } catch (err) {
      logger.error({ err }, "Failed to stop a cron task");
    }
  }
  scheduledTasks.length = 0;
}
