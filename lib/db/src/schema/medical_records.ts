import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { appointmentsTable } from "./appointments";
import { clinicsTable } from "./clinics";

export const medicalRecordsTable = pgTable("medical_records", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  appointmentId: integer("appointment_id").references(() => appointmentsTable.id),
  chiefComplaint: text("chief_complaint").notNull(),
  chiefComplaintAr: text("chief_complaint_ar"),
  diagnosis: text("diagnosis").notNull(),
  diagnosisAr: text("diagnosis_ar"),
  treatment: text("treatment").notNull(),
  treatmentAr: text("treatment_ar"),
  notes: text("notes"),
  vitals: jsonb("vitals"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("mr_patient_idx").on(t.patientId),
  index("mr_doctor_idx").on(t.doctorId),
  index("mr_created_idx").on(t.createdAt),
  index("mr_clinic_idx").on(t.clinicId),
  index("mr_clinic_patient_created_idx").on(t.clinicId, t.patientId, t.createdAt),
  index("mr_clinic_doctor_created_idx").on(t.clinicId, t.doctorId, t.createdAt),
]);

export const insertMedicalRecordSchema = createInsertSchema(medicalRecordsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertMedicalRecord = z.infer<typeof insertMedicalRecordSchema>;
export type MedicalRecord = typeof medicalRecordsTable.$inferSelect;
