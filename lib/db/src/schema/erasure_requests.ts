import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

export const erasureStatusEnum = pgEnum("erasure_status", [
  "pending",   // submitted, awaiting review
  "approved",  // approved by compliance_officer, awaiting super_admin execution
  "rejected",  // rejected with reason
  "executed",  // anonymization completed
]);

// Right-to-erasure requests (GDPR Art. 17 / PDPL equivalent).
// Execution anonymizes all PHI associated with the patient — it is irreversible.
// Hard deletion is prohibited per ADR-005; anonymization is the correct approach.
export const erasureRequestsTable = pgTable("erasure_requests", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1).references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => usersTable.id),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  reason: text("reason").notNull(),
  status: erasureStatusEnum("status").notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  executedByUserId: integer("executed_by_user_id").references(() => usersTable.id),
  executedAt: timestamp("executed_at"),
  // Backups produced before this time still contain pre-erasure PHI.
  // Before restoring any backup, check erasure_requests WHERE status='executed'
  // AND erasure_blackout_until > now() — and re-apply anonymization for each row.
  // Value = executedAt + BACKUP_RETENTION_DAYS (default 7).
  erasureBlackoutUntil: timestamp("erasure_blackout_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("erasure_patient_idx").on(t.patientId),
  index("erasure_status_idx").on(t.status),
  index("erasure_clinic_idx").on(t.clinicId),
]);

export const insertErasureRequestSchema = createInsertSchema(erasureRequestsTable).omit({
  id: true,
  clinicId: true,
  status: true,
  reviewedByUserId: true,
  reviewedAt: true,
  reviewNotes: true,
  executedByUserId: true,
  executedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertErasureRequest = z.infer<typeof insertErasureRequestSchema>;
export type ErasureRequest = typeof erasureRequestsTable.$inferSelect;
