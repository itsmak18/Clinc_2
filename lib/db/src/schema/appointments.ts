import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  scheduledAt: timestamp("scheduled_at").notNull(),
  reason: text("reason").notNull(),
  status: appointmentStatusEnum("status").notNull().default("scheduled"),
  cancellationReason: text("cancellation_reason"),
  notes: text("notes"),
  checkedInAt: timestamp("checked_in_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
