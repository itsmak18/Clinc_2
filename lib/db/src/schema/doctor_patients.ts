import { pgTable, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

// Materialized scope table — doctor ↔ patient relationship log.
//
// An entry exists for every (doctor, patient) pair where the doctor has ever
// had an appointment with the patient (regardless of status — even cancelled
// appointments represent a historical clinical relationship).
//
// This makes getDoctorPatientScope() O(1) per lookup instead of O(N) on the
// full appointments table. The Redis cache layer remains but is now optional.
//
// Maintained by: recordDoctorPatientLink() in lib/scope.ts, called from
// createAppointment() and updateAppointment() in appointments.service.ts.
// Backfilled from appointments in migration 0009_*.
export const doctorPatientsTable = pgTable("doctor_patients", {
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.doctorId, t.patientId] }),
  index("dp_doctor_idx").on(t.doctorId),
  index("dp_clinic_idx").on(t.clinicId),
]);

export type DoctorPatient = typeof doctorPatientsTable.$inferSelect;
