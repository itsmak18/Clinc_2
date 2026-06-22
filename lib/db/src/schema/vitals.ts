import { pgTable, uuid, integer, jsonb, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { appointmentsTable } from "./appointments";
import { clinicsTable } from "./clinics";
import { uuidV7 } from "../uuid-v7";

/**
 * Nurse-recorded vital signs — a FIRST-CLASS clinical record, NOT a medical
 * record. Separating them means a nurse can record vitals without `treatment`
 * consent and without inventing a placeholder diagnosis (the old hack stored
 * vitals on `medical_records` with `diagnosis = "Pending — triage only"`).
 *
 * The `vitals` JSONB is field-encrypted (PHI) exactly like `medical_records.vitals`
 * — written via `encryptJsonNullable`, read via `decryptJsonNullable`, shape
 * guarded by `vitalsSchema`. New PHI table ⇒ `executeErasure` scrubs it.
 */
export const vitalsTable = pgTable("vitals", {
  id: uuid("id").$defaultFn(uuidV7).primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  appointmentId: integer("appointment_id").references(() => appointmentsTable.id),
  recordedById: integer("recorded_by_id").notNull().references(() => usersTable.id),
  vitals: jsonb("vitals"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("vitals_patient_idx").on(t.patientId),
  index("vitals_appointment_idx").on(t.appointmentId),
  index("vitals_clinic_patient_created_idx").on(t.clinicId, t.patientId, t.createdAt),
]);

export type Vitals = typeof vitalsTable.$inferSelect;
