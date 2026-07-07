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
import { drainAuditOutbox, logAudit, SYSTEM_USER_ID } from "./lib/audit";
import { reconcileBreakGlassAuditFallback } from "./lib/break-glass-audit";
import { reconcileAuditOutboxFallback } from "./lib/audit-outbox-fallback";
import { recordDailyIntegrity, verifyRecentIntegrity, verifyChainLinkage } from "./lib/audit-integrity";
import { auditPartitionMonthsRemainingGauge } from "./lib/metrics";
import { purgeOldCspReports, DEFAULT_CSP_RETENTION_DAYS } from "./modules/audit/csp-report.service";
import { reconcileOrphanImagingFiles, DEFAULT_ORPHAN_GRACE_HOURS } from "./modules/imaging/imaging-attachments.service";
import { expirePendingClearances } from "./modules/billing";
import { config } from "./lib/config";

// Tracks every cron task so the graceful-shutdown path can stop them before
// the DB pool is drained (H7). Without this, an in-flight cron callback could
// fire a write against a closed pool and crash the process post-server-close.
const scheduledTasks: ScheduledTask[] = [];

let drainInterval: ReturnType<typeof setInterval> | null = null;
let bgReconcileInterval: ReturnType<typeof setInterval> | null = null;
let auditOutboxReconcileInterval: ReturnType<typeof setInterval> | null = null;

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

/**
 * Start the 60-second break-glass audit fallback reconcile loop.
 * Drains any JSONL lines from the local fallback sink into audit_logs and
 * re-records daily integrity hashes for affected dates. Idempotent.
 */
export function startBgAuditReconcile(): void {
  if (bgReconcileInterval) return;
  bgReconcileInterval = setInterval(async () => {
    try {
      const result = await reconcileBreakGlassAuditFallback();
      if (result.inserted > 0) {
        logger.info(result, "bg_break_glass_audit_reconcile_tick");
      }
    } catch (err) {
      logger.warn({ err }, "bg_break_glass_audit_reconcile_tick_failed");
    }
  }, 60_000);
  bgReconcileInterval.unref();
  logger.info("Break-glass audit fallback reconcile started (60s interval)");
}

/** Stop the break-glass audit fallback reconcile loop. Idempotent. */
export function stopBgAuditReconcile(): void {
  if (!bgReconcileInterval) return;
  clearInterval(bgReconcileInterval);
  bgReconcileInterval = null;
  logger.info("Break-glass audit fallback reconcile stopped");
}

/**
 * Start the 60-second audit-outbox write-failure fallback reconcile loop
 * (AUD-SEAM-01). Drains any JSONL lines from the local fallback sink back
 * into audit_outbox, where the normal 5s drain + hash-chain path picks them
 * up like any other event. Idempotent.
 */
export function startAuditOutboxReconcile(): void {
  if (auditOutboxReconcileInterval) return;
  auditOutboxReconcileInterval = setInterval(async () => {
    try {
      const result = await reconcileAuditOutboxFallback();
      if (result.inserted > 0) {
        logger.info(result, "audit_outbox_fallback_reconcile_tick");
      }
    } catch (err) {
      logger.warn({ err }, "audit_outbox_fallback_reconcile_tick_failed");
    }
  }, 60_000);
  auditOutboxReconcileInterval.unref();
  logger.info("Audit-outbox fallback reconcile started (60s interval)");
}

/** Stop the audit-outbox fallback reconcile loop. Idempotent. */
export function stopAuditOutboxReconcile(): void {
  if (!auditOutboxReconcileInterval) return;
  clearInterval(auditOutboxReconcileInterval);
  auditOutboxReconcileInterval = null;
  logger.info("Audit-outbox fallback reconcile stopped");
}

export interface ClinicRetentionCounts {
  overdueAuditLogs: number;
  openErasureRequests: number;
  softDeletedPatientsOverThirtyDays: number;
}

/**
 * V-01: compute the data-retention figures PER CLINIC.
 *
 * Prior to the fix this ran as three GLOBAL COUNT(*) queries whose totals were
 * pushed to every clinic's compliance officers — a cross-tenant leak the instant
 * a second clinic onboards. Grouping by clinic_id keeps the tenant isolation the
 * rest of the system enforces (audit_logs / erasure_requests / patients all carry
 * clinic_id). Bare `db` (NOT runInTenantContext) is intentional: a system
 * governance job must see every clinic so the caller can route each clinic's
 * figures to that clinic's own officers.
 *
 * Kept as an exported, side-effect-free function (queries only — no SSE, no
 * logging) so the isolation property (a clinic's entry reflects ONLY its own
 * rows) is directly testable against a real Postgres.
 */
export async function computeRetentionByClinic(): Promise<Map<number, ClinicRetentionCounts>> {
  const sevenYearsAgo = new Date();
  sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [overdueByClinic, openByClinic, softDeletedByClinic] = await Promise.all([
    db
      .select({ clinicId: auditLogsTable.clinicId, count: sql<number>`count(*)` })
      .from(auditLogsTable)
      .where(lt(auditLogsTable.createdAt, sevenYearsAgo))
      .groupBy(auditLogsTable.clinicId),
    db
      .select({ clinicId: erasureRequestsTable.clinicId, count: sql<number>`count(*)` })
      .from(erasureRequestsTable)
      .where(eq(erasureRequestsTable.status, "pending"))
      .groupBy(erasureRequestsTable.clinicId),
    // V-02: soft-deleted patients older than 30 days — NOT "pending erasure" (the
    // old name implied an erasure-request join the query never performed).
    db
      .select({ clinicId: patientsTable.clinicId, count: sql<number>`count(*)` })
      .from(patientsTable)
      .where(lte(patientsTable.deletedAt, thirtyDaysAgo))
      .groupBy(patientsTable.clinicId),
  ]);

  const perClinic = new Map<number, ClinicRetentionCounts>();
  const forClinic = (clinicId: number): ClinicRetentionCounts => {
    let row = perClinic.get(clinicId);
    if (!row) {
      row = { overdueAuditLogs: 0, openErasureRequests: 0, softDeletedPatientsOverThirtyDays: 0 };
      perClinic.set(clinicId, row);
    }
    return row;
  };
  for (const r of overdueByClinic)     forClinic(r.clinicId).overdueAuditLogs = Number(r.count ?? 0);
  for (const r of openByClinic)        forClinic(r.clinicId).openErasureRequests = Number(r.count ?? 0);
  for (const r of softDeletedByClinic) forClinic(r.clinicId).softDeletedPatientsOverThirtyDays = Number(r.count ?? 0);
  return perClinic;
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
      const perClinic = await computeRetentionByClinic();

      logger.info(
        { clinics: perClinic.size, report: Object.fromEntries(perClinic) },
        "[Cron] Data Retention Report (per-clinic)",
      );

      // Fan out each clinic's own numbers to that clinic's compliance officers
      // only. Same-clinic officer query mirrors break-glass.service.ts.
      for (const [clinicId, counts] of perClinic) {
        if (counts.overdueAuditLogs === 0 && counts.openErasureRequests === 0) continue;
        const officers = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(eq(usersTable.clinicId, clinicId), eq(usersTable.role, "compliance_officer")));

        for (const officer of officers) {
          emitToUser(officer.id, "retention_report", {
            overdueAuditLogs: counts.overdueAuditLogs,
            openErasureRequests: counts.openErasureRequests,
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
        // trail (§164.312(b) gap). Recorded under the system actor, one entry
        // PER CLINIC attributed to that clinic: a single cross-tenant row
        // would land under SYSTEM_CLINIC_ID (= clinic 1) with every clinic's
        // appointment ids in its details — readable by clinic 1's compliance
        // officers, since audit reads are WHERE-scoped to the caller's clinic.
        const byClinic = new Map<number, number[]>();
        for (const r of result) {
          const ids = byClinic.get(r.clinicId) ?? [];
          ids.push(r.id);
          byClinic.set(r.clinicId, ids);
        }
        for (const [clinicId, appointmentIds] of byClinic) {
          const systemReq = { headers: {}, user: { userId: SYSTEM_USER_ID, clinicId } } as unknown as Request;
          await logAudit(
            systemReq,
            "SYSTEM_NO_SHOW",
            "appointment",
            undefined,
            { count: appointmentIds.length, appointmentIds },
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "[Cron] Failed to run No-show Auto-Transition");
    }
  }));

  // Clearance-gate expiry sweep (hourly at :15 — offset from the :00 no-show
  // job). Orders that sat clearance_status='pending' past CLEARANCE_TTL_HOURS
  // expire, their basket charge lines are withdrawn, and an emptied basket is
  // auto-cancelled. Runs regardless of CLEARANCE_GATE_ENABLED (data plane:
  // pending rows only exist from flag-ON operation and must still drain after
  // a rollback); writes one SYSTEM_CLEARANCE_EXPIRED audit per affected
  // clinic per non-empty run (ADR-011).
  scheduledTasks.push(cron.schedule("15 * * * *", async () => {
    try {
      const { expired, basketsCancelled } = await expirePendingClearances();
      if (expired > 0) {
        logger.info({ expired, basketsCancelled }, "[Cron] Clearance expiry sweep complete");
      }
    } catch (err) {
      logger.error({ err }, "[Cron] Clearance expiry sweep failed");
    }
  }));

  // CSP report retention purge (runs daily at 03:30 UTC — off-peak, clear of the
  // 02:00 integrity job and the 03:00 monthly retention report). Enforces the
  // documented 90-day retention so csp_reports cannot grow unbounded (F-M2).
  // Override the window with CSP_REPORT_RETENTION_DAYS. Harmless when the CSP
  // report flag is off (table empty → deletes 0).
  scheduledTasks.push(cron.schedule("30 3 * * *", async () => {
    logger.info("[Cron] Running CSP report retention purge");
    try {
      const retentionDays = config.cspReportRetentionDays || DEFAULT_CSP_RETENTION_DAYS;
      const purged = await purgeOldCspReports(retentionDays);
      logger.info({ purged, retentionDays }, "[Cron] CSP report retention purge complete");
    } catch (err) {
      logger.error({ err }, "[Cron] CSP report retention purge failed");
    }
  }));

  // Orphaned imaging-file reclamation (runs daily at 04:00 UTC). Deletes encrypted
  // X-ray/ultrasound files on disk with no live imaging_attachments row — the
  // crash-between-write-and-insert and failed-unlink orphan classes (F-M5). A
  // grace window (IMAGING_ORPHAN_GRACE_HOURS, default 24h) protects in-flight
  // uploads. No-op when IMAGING_STORAGE_DIR is empty.
  scheduledTasks.push(cron.schedule("0 4 * * *", async () => {
    logger.info("[Cron] Running imaging orphan-file reconciliation");
    try {
      const graceHours = config.imagingOrphanGraceHours || DEFAULT_ORPHAN_GRACE_HOURS;
      const summary = await reconcileOrphanImagingFiles(graceHours);
      logger.info({ ...summary, graceHours }, "[Cron] Imaging orphan-file reconciliation complete");
    } catch (err) {
      logger.error({ err }, "[Cron] Imaging orphan-file reconciliation failed");
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
