import { pgTable, serial, text, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { appointmentsTable } from "./appointments";

export const medicalRecordsTable = pgTable("medical_records", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  appointmentId: integer("appointment_id").references(() => appointmentsTable.id),
  chiefComplaint: text("chief_complaint").notNull(),
  diagnosis: text("diagnosis").notNull(),
  treatment: text("treatment").notNull(),
  notes: text("notes"),
  vitals: jsonb("vitals"),
  isGlobal: boolean("is_global").notNull().default(false),
  globalReason: text("global_reason"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("mr_patient_idx").on(t.patientId),   // M-04
  index("mr_doctor_idx").on(t.doctorId),     // M-04
  index("mr_created_idx").on(t.createdAt),   // M-04
]);

export const insertMedicalRecordSchema = createInsertSchema(medicalRecordsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertMedicalRecord = z.infer<typeof insertMedicalRecordSchema>;
export type MedicalRecord = typeof medicalRecordsTable.$inferSelect;
