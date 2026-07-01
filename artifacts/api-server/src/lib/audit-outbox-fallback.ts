/**
 * Durable local fallback for the general audit-outbox write path (AUD-SEAM-01,
 * 2026-07-02 engineering audit).
 *
 * logAudit()'s hot path inserts into audit_outbox; previously, if that very
 * first INSERT failed (not the later drain — the initial write), the event
 * was only counted (audit_log_write_failures_total) and logged — a silent
 * HIPAA §164.312(b) gap for ordinary (non break-glass) audit events during an
 * audit-DB outage.
 *
 * This mirrors break-glass-audit.ts's fallback shape but reconciles back into
 * audit_outbox, not directly into audit_logs: these rows are a delayed
 * outbox write, not an emergency-access event that must land in audit_logs
 * synchronously, so they can safely re-enter the normal 5-second drain +
 * hash-chain path once reconciled (no special date/partition handling needed
 * — audit_outbox.created_at defaults on insert like any other outbox row).
 */

import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { auditOutboxTable } from "@workspace/db";
import {
  auditOutboxFallbackTotal,
  auditOutboxFallbackWriteFailuresTotal,
  auditOutboxFallbackPendingGauge,
} from "./metrics";
import { logger } from "./logger";
import { config } from "./config";

const FALLBACK_DIR = config.auditOutboxFallbackDir;
const FALLBACK_FILE = path.join(FALLBACK_DIR, "fallback.jsonl");

function ensureFallbackDir(): void {
  try {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  } catch { /* best-effort — if mkdirSync fails the appendFileSync below also fails and is counted */ }
}

function updatePendingGauge(): void {
  try {
    if (!fs.existsSync(FALLBACK_FILE)) { auditOutboxFallbackPendingGauge.set(0); return; }
    const content = fs.readFileSync(FALLBACK_FILE, "utf8").trim();
    auditOutboxFallbackPendingGauge.set(content ? content.split("\n").length : 0);
  } catch { /* best-effort */ }
}

/**
 * Durably append an audit row whose normal audit_outbox INSERT just failed.
 * Never throws — this is a last-resort durability layer, not a hard
 * requirement; the caller (logAudit) must not fail because auditing failed.
 */
export function appendAuditOutboxFallback(
  row: Record<string, unknown>,
  action: string,
  entityType: string,
): void {
  try {
    ensureFallbackDir();
    fs.appendFileSync(FALLBACK_FILE, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
    auditOutboxFallbackTotal.labels(action, entityType).inc();
    updatePendingGauge();
    logger.warn({ action, entityType }, "audit_outbox_write_failed_written_to_fallback_sink");
  } catch (sinkErr) {
    auditOutboxFallbackWriteFailuresTotal.labels(action, entityType).inc();
    logger.error(
      { err: sinkErr, action, entityType },
      "audit_outbox_fallback_write_failed_event_unrecorded",
    );
    // Never throw — hybrid mode: the original operation already completed;
    // this is the last-resort durability layer for the audit trail only.
  }
}

/**
 * Reconcile fallback-sink rows back into audit_outbox so the normal 5s drain
 * (and hash-chain integrity) picks them up like any other event. Best-effort;
 * never throws. Called on a 60s interval by the background worker and once
 * during graceful shutdown.
 */
export async function reconcileAuditOutboxFallback(): Promise<{
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
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        result.parseErrors++;
      }
    }

    if (rows.length === 0) {
      updatePendingGauge();
      return result;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(auditOutboxTable).values(rows as any[]);
    result.inserted = rows.length;

    // Truncate the sink — rows are now back in audit_outbox for the normal drain.
    fs.writeFileSync(FALLBACK_FILE, "", "utf8");
    auditOutboxFallbackPendingGauge.set(0);

    logger.info(result, "audit_outbox_fallback_reconciled");
  } catch (err) {
    logger.warn({ err }, "audit_outbox_fallback_reconcile_failed");
  }
  return result;
}
