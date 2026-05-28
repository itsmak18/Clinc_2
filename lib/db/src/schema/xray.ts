import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { appointmentsTable } from "./appointments";
import { clinicsTable } from "./clinics";

export const xrayStatusEnum = pgEnum("xray_status", ["pending", "uploaded", "reviewed"]);

export const xrayRecordsTable = pgTable("xray_records", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1).references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  requestedById: integer("requested_by_id").notNull().references(() => usersTable.id),
  performedById: integer("performed_by_id").references(() => usersTable.id),
  appointmentId: integer("appointment_id").references(() => appointmentsTable.id),
  bodyPart: text("body_part").notNull(),
  imageUrl: text("image_url"),
  imageFileName: text("image_file_name"),
  report: text("report"),
  status: xrayStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("xray_patient_idx").on(t.patientId),
  index("xray_appt_idx").on(t.appointmentId),
  index("xray_created_idx").on(t.createdAt),
  index("xray_status_idx").on(t.status),
  index("xray_clinic_idx").on(t.clinicId),
]);

export const insertXrayRecordSchema = createInsertSchema(xrayRecordsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertXrayRecord = z.infer<typeof insertXrayRecordSchema>;
export type XrayRecord = typeof xrayRecordsTable.$inferSelect;
