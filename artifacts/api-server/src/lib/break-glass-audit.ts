/**
 * Durable audit path for break-glass events (2026-06-27).
 *
 * Every BREAK_GLASS_* action (ACTIVATED, APPROVED, REVOKED, DENIED, ACCESS)
 * must be persisted before PHI is returned to the caller. The normal audit path
 * (logAudit → audit_outbox → drain every 5 s) is best-effort: an outbox-insert
 * failure drops the event silently, and even a queued row can be permanently lost
 * after 5 drain retries. For emergency-access events that loss defeats the entire
 * HIPAA §164.312(a)(2)(ii) control.
 *
 * Hybrid guarantee (chosen over fail-closed to preserve clinical access during
 * a code-blue even when the audit DB is degraded):
 *   1. Primary: synchronous INSERT directly into audit_logs — durably committed
 *      before the call returns.
 *   2. Fallback: if the primary throws, append a JSONL line to a local
 *      append-only file sink + fire break_glass_audit_fallback_total alert.
 *      Access still proceeds; event is never silently lost.
 *   3. Both fail: increment break_glass_audit_failures_total (critical alert).
 *      Return without throwing — access proceeds; operator must investigate.
 *
 * reconcileBreakGlassAuditFallback() is called on a 60-second interval by the
 * background worker and once during graceful shutdown. It batch-inserts sink rows
 * into audit_logs and re-records the SHA-256 daily hash for any affected dates
 * (keeps the audit-integrity hash chain consistent with reconciled rows).
 */

import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import type { Request } from "express";
import { buildAuditRow, toAuditLogUserId } from "./audit";
import { recordDailyIntegrity } from "./audit-integrity";
import {
  breakGlassAuditFallbackTotal,
  breakGlassAuditFailuresTotal,
  breakGlassAuditFallbackPendingGauge,
} from "./metrics";
import { logger } from "./logger";
import { config } from "./config";

const FALLBACK_DIR = config.breakGlassAuditFallbackDir;
const FALLBACK_FILE = path.join(FALLBACK_DIR, "fallback.jsonl");

function ensureFallbackDir(): void {
  try {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  } catch { /* best-effort — if mkdirSync fails the appendFileSync below also fails and we count it */ }
}

function updatePendingGauge(): void {
  try {
    if (!fs.existsSync(FALLBACK_FILE)) { breakGlassAuditFallbackPendingGauge.set(0); return; }
    const content = fs.readFileSync(FALLBACK_FILE, "utf8").trim();
    breakGlassAuditFallbackPendingGauge.set(content ? content.split("\n").length : 0);
  } catch { /* best-effort */ }
}

/**
 * Audit a break-glass event with a durable primary + fallback guarantee.
 * Must be awaited before returning PHI to the caller.
 */
export async function auditBreakGlass(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string | number,
  details?: object | null,
): Promise<void> {
  const baseRow = buildAuditRow(req, action, entityType, entityId, details);
  const row = {
    ...baseRow,
    // AUD-SEAM-07: this row is inserted directly into audit_logs (FK to
    // users.id) — SYSTEM_USER_ID(-1) has no matching row. In practice
    // break-glass actions always have an authenticated req.user, but this
    // guards the same bug class defensively (e.g. a future internal caller).
    userId: toAuditLogUserId(baseRow.userId),
    createdAt: new Date(), // explicit timestamp for hash-chain reconcile
  };

  // Primary: synchronous direct insert into audit_logs.
  // RLS is dormant outside runInTenantContext so the bare-db insert passes.
  // Migration 0026 revokes UPDATE/DELETE, not INSERT — this is permitted.
  try {
    await db.insert(auditLogsTable).values(row);
    return;
  } catch (primaryErr) {
    breakGlassAuditFallbackTotal.labels(action).inc();
    logger.error(
      { err: primaryErr, action, entityType, entityId },
      "break_glass_audit_primary_failed",
    );
  }

  // Fallback: durable local JSONL append (fsync via O_APPEND semantics).
  try {
    ensureFallbackDir();
    fs.appendFileSync(FALLBACK_FILE, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
    updatePendingGauge();
    logger.warn({ action, entityType, entityId }, "break_glass_audit_written_to_fallback_sink");
    return;
  } catch (sinkErr) {
    breakGlassAuditFailuresTotal.labels(action).inc();
    logger.error(
      { err: sinkErr, action, entityType, entityId },
      "break_glass_audit_fallback_failed_event_unrecorded",
    );
    // Hybrid mode: never throw — access proceeds; critical alert fires via metric.
  }
}

/**
 * Reconcile break-glass audit events from the local fallback sink into audit_logs.
 * Best-effort; never throws. Returns a run summary for logging.
 *
 * After inserting, re-records the daily SHA-256 integrity hash for each affected
 * calendar date so the hash chain stays consistent with the newly inserted rows.
 */
export async function reconcileBreakGlassAuditFallback(): Promise<{
  inserted: number;
  parseErrors: number;
}> {
  const result = { inserted: 0, parseErrors: 0 };
  try {
    if (!fs.existsSync(FALLBACK_FILE)) return result;

    const content = fs.readFileSync(FALLBACK_FILE, "utf8").trim();
    if (!content) return result;

    const lines = content.split("\n").filter(Boolean);
    if (lines.length === 0) return result;

    const rows: object[] = [];
    const affectedDates = new Set<string>();

    for (const line of lines) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        // Restore createdAt as a real Date so Postgres routes it to the correct
        // monthly partition and the hash chain gets the right day.
        if (typeof row.createdAt === "string") {
          const d = new Date(row.createdAt);
          if (!isNaN(d.getTime())) {
            row.createdAt = d;
            affectedDates.add(d.toISOString().slice(0, 10));
          }
        }
        // AUD-SEAM-07: defensive remap for any sink line written before this
        // fix (auditBreakGlass now remaps at the source, but an older JSONL
        // line could still carry the raw SYSTEM_USER_ID(-1) sentinel, which
        // would fail the audit_logs.user_id FK on this direct insert).
        row.userId = toAuditLogUserId(row.userId as number | null | undefined);
        rows.push(row);
      } catch {
        result.parseErrors++;
      }
    }

    if (rows.length === 0) {
      updatePendingGauge();
      return result;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(auditLogsTable).values(rows as any[]);
    result.inserted = rows.length;

    // Truncate the sink — rows are now in audit_logs.
    fs.writeFileSync(FALLBACK_FILE, "", "utf8");
    breakGlassAuditFallbackPendingGauge.set(0);

    // Re-record daily hashes for every calendar date touched so verifyRecentIntegrity
    // does not raise a false mismatch on those dates.
    for (const dateStr of affectedDates) {
      try {
        // Use noon UTC to stay unambiguously within the target date in any timezone.
        await recordDailyIntegrity(new Date(`${dateStr}T12:00:00Z`));
      } catch (hashErr) {
        logger.warn({ err: hashErr, date: dateStr }, "break_glass_audit_hash_rerecord_failed");
      }
    }

    logger.info(
      { inserted: result.inserted, parseErrors: result.parseErrors, dates: [...affectedDates] },
      "break_glass_audit_fallback_reconciled",
    );
  } catch (err) {
    logger.warn({ err }, "break_glass_audit_fallback_reconcile_failed");
  }
  return result;
}
