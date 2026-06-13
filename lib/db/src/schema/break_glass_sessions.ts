import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

// Break-glass sessions grant time-limited emergency PHI access to a patient record.
// Activating a session immediately alerts all compliance_officer users via SSE.
// Every PHI access during an active session is logged with action BREAK_GLASS_ACCESS
// in addition to the normal audit log entry.
export const breakGlassSessionsTable = pgTable("break_glass_sessions", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  justification: text("justification").notNull(),
  activatedAt: timestamp("activated_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  // Phase 3.4 (2026-05-31): compliance approval gate.
  // A newly activated session has approvedAt = NULL and is valid only during
  // the 5-minute grace window (BREAK_GLASS_GRACE_MS). A compliance_officer must
  // call POST /break-glass/sessions/:id/approve to extend access to expiresAt.
  // Without approval the session auto-expires at activatedAt + grace.
  approvedAt: timestamp("approved_at"),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  revokedAt: timestamp("revoked_at"),
  revokedByUserId: integer("revoked_by_user_id").references(() => usersTable.id),
  alertSentAt: timestamp("alert_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("bgs_user_idx").on(t.userId),
  index("bgs_patient_idx").on(t.patientId),
  index("bgs_expires_idx").on(t.expiresAt),
  index("bgs_clinic_idx").on(t.clinicId),
]);

export const insertBreakGlassSchema = createInsertSchema(breakGlassSessionsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
});

export type InsertBreakGlassSession = z.infer<typeof insertBreakGlassSchema>;
export type BreakGlassSession = typeof breakGlassSessionsTable.$inferSelect;
