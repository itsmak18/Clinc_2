import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

// Transactional outbox for audit writes.
// The hot-path (logAudit) inserts here — no indexes, so writes are O(1).
// A 5-second drain worker transfers rows to audit_logs and deletes them on success.
// Rows that fail MAX_ATTEMPTS times are abandoned and counted in the
// audit_log_write_failures_total Prometheus counter.
//
// No FK references to users/clinics — we want outbox writes to succeed even if
// referential state has changed before the drain worker runs.
export const auditOutboxTable = pgTable("audit_outbox", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1),
  userId: integer("user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  requestId: text("request_id"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditOutboxRow = typeof auditOutboxTable.$inferSelect;
