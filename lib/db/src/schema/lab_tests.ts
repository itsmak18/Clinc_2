import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { appointmentsTable } from "./appointments";
import { clinicsTable } from "./clinics";

export const labTestStatusEnum = pgEnum("lab_test_status", [
  "requested",
  "in_progress",
  "completed",
  "cancelled",
]);

export const labTestsTable = pgTable("lab_tests", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  requestedById: integer("requested_by_id").notNull().references(() => usersTable.id),
  performedById: integer("performed_by_id").references(() => usersTable.id),
  appointmentId: integer("appointment_id").references(() => appointmentsTable.id),
  testName: text("test_name").notNull(),
  testNameAr: text("test_name_ar"),
  results: text("results"),
  resultsAr: text("results_ar"),
  status: labTestStatusEnum("status").notNull().default("requested"),
  notes: text("notes"),
  notesAr: text("notes_ar"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lab_patient_idx").on(t.patientId),
  index("lab_appt_idx").on(t.appointmentId),
  index("lab_created_idx").on(t.createdAt),
  index("lab_status_idx").on(t.status),
  index("lab_clinic_idx").on(t.clinicId),
  index("lab_clinic_patient_created_idx").on(t.clinicId, t.patientId, t.createdAt),
  index("lab_clinic_status_created_idx").on(t.clinicId, t.status, t.createdAt),
]);

export const insertLabTestSchema = createInsertSchema(labTestsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertLabTest = z.infer<typeof insertLabTestSchema>;
export type LabTest = typeof labTestsTable.$inferSelect;
