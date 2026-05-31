import { pgTable, serial, text, integer, timestamp, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "checked_in",
  "in_triage",
  "ready_for_doctor",
  "in_consultation",
  "awaiting_diagnostics",
  "pending_payment",
  "completed",
  "cancelled",
  "no_show",
]);

export const bookingSourceEnum = pgEnum("booking_source", ["online", "phone", "walk_in"]);

export const triagePriorityEnum = pgEnum("triage_priority", ["normal", "urgent", "critical"]);

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1).references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  scheduledAt: timestamp("scheduled_at").notNull(),
  reason: text("reason").notNull(),
  status: appointmentStatusEnum("status").notNull().default("scheduled"),
  bookingSource: bookingSourceEnum("booking_source").notNull().default("walk_in"),
  triagePriority: triagePriorityEnum("triage_priority").notNull().default("normal"),
  cancellationReason: text("cancellation_reason"),
  notes: text("notes"),
  checkedInAt: timestamp("checked_in_at"),
  triageStartedAt: timestamp("triage_started_at"),
  consultationStartedAt: timestamp("consultation_started_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("appt_patient_idx").on(t.patientId),
  index("appt_doctor_idx").on(t.doctorId),
  index("appt_scheduled_idx").on(t.scheduledAt),
  index("appt_status_idx").on(t.status),
  index("appt_doctor_scheduled_idx").on(t.doctorId, t.scheduledAt),
  uniqueIndex("appt_no_double_book_idx").on(t.doctorId, t.scheduledAt)
    .where(sql`status NOT IN ('cancelled', 'no_show')`),
  index("appt_updated_idx").on(t.updatedAt),
  index("appt_clinic_idx").on(t.clinicId),
  index("appt_clinic_doctor_scheduled_idx").on(t.clinicId, t.doctorId, t.scheduledAt),
  index("appt_clinic_scheduled_status_idx").on(t.clinicId, t.scheduledAt, t.status),
]);

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
