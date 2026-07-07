import { pgTable, serial, text, integer, timestamp, pgEnum, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { appointmentsTable } from "./appointments";
import { clinicsTable } from "./clinics";
import { clearanceStatusEnum } from "./billing";
import { invoiceItemsTable } from "./invoice_items";

// Workflow: requested (doctor ordered) → in_progress (tech acquiring/uploading)
// → completed (images + report finalized). Renamed from pending/uploaded/reviewed
// in migration 0038 (ALTER TYPE … RENAME VALUE — values renamed in place).
// "cancelled" added in migration 0041 — ADD VALUE must live alone in its own
// migration file (PG forbids using a new enum value in the tx that added it).
export const xrayStatusEnum = pgEnum("xray_status", ["requested", "in_progress", "completed", "cancelled"]);

export const xrayRecordsTable = pgTable("xray_records", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  requestedById: integer("requested_by_id").notNull().references(() => usersTable.id),
  performedById: integer("performed_by_id").references(() => usersTable.id),
  appointmentId: integer("appointment_id").references(() => appointmentsTable.id),
  bodyPart: text("body_part").notNull(),
  bodyPartAr: text("body_part_ar"),
  imageUrl: text("image_url"),
  imageFileName: text("image_file_name"),
  // Additional images beyond the cover (imageUrl). Studies can hold several photos.
  images: jsonb("images").$type<{ url: string; fileName?: string; caption?: string }[]>(),
  // Ties together studies created in the same request/visit (e.g. chest + left hand).
  orderGroupId: text("order_group_id"),
  // Financial clearance gate (migration 0042) — see lab_tests.ts for semantics.
  clearanceStatus: clearanceStatusEnum("clearance_status").notNull().default("cleared"),
  invoiceItemId: integer("invoice_item_id").references(() => invoiceItemsTable.id),
  report: text("report"),
  reportAr: text("report_ar"),
  status: xrayStatusEnum("status").notNull().default("requested"),
  notes: text("notes"),
  notesAr: text("notes_ar"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("xray_patient_idx").on(t.patientId),
  index("xray_appt_idx").on(t.appointmentId),
  index("xray_created_idx").on(t.createdAt),
  index("xray_status_idx").on(t.status),
  index("xray_clinic_idx").on(t.clinicId),
  index("xray_clinic_patient_created_idx").on(t.clinicId, t.patientId, t.createdAt),
  index("xray_clinic_status_created_idx").on(t.clinicId, t.status, t.createdAt),
  index("xray_order_group_idx").on(t.clinicId, t.orderGroupId),
  index("xray_clearance_idx").on(t.clinicId, t.clearanceStatus),
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
