import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { medicalRecordsTable } from "./medical_records";
import { clinicsTable } from "./clinics";

export const prescriptionsTable = pgTable("prescriptions", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1).references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  recordId: integer("record_id").references(() => medicalRecordsTable.id),
  medications: jsonb("medications").notNull(),
  notes: text("notes"),
  notesAr: text("notes_ar"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("rx_patient_idx").on(t.patientId),
  index("rx_doctor_idx").on(t.doctorId),
  index("rx_created_idx").on(t.createdAt),
  index("rx_clinic_idx").on(t.clinicId),
  index("rx_clinic_patient_created_idx").on(t.clinicId, t.patientId, t.createdAt),
]);

export const insertPrescriptionSchema = createInsertSchema(prescriptionsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertPrescription = z.infer<typeof insertPrescriptionSchema>;
export type Prescription = typeof prescriptionsTable.$inferSelect;
