import { pgTable, serial, text, integer, timestamp, pgEnum, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

// Workflow: requested → in_progress → completed (renamed from pending/uploaded/
// reviewed in migration 0038 via ALTER TYPE … RENAME VALUE).
export const ultrasoundStatusEnum = pgEnum("ultrasound_status", ["requested", "in_progress", "completed"]);

export const ultrasoundRecordsTable = pgTable("ultrasound_records", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  requestedById: integer("requested_by_id").notNull().references(() => usersTable.id),
  performedById: integer("performed_by_id").references(() => usersTable.id),
  examType: text("exam_type").notNull(),
  bodyPart: text("body_part").notNull(),
  bodyPartAr: text("body_part_ar"),
  imageUrl: text("image_url"),
  imageFileName: text("image_file_name"),
  // Additional images beyond the cover (imageUrl). Studies can hold several photos.
  images: jsonb("images").$type<{ url: string; fileName?: string; caption?: string }[]>(),
  // Ties together exams created in the same request/visit (e.g. abdominal + pelvic).
  orderGroupId: text("order_group_id"),
  report: text("report"),
  reportAr: text("report_ar"),
  status: ultrasoundStatusEnum("status").notNull().default("requested"),
  notes: text("notes"),
  notesAr: text("notes_ar"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ultrasound_clinic_idx").on(t.clinicId),
  index("ultrasound_clinic_patient_created_idx").on(t.clinicId, t.patientId, t.createdAt),
  index("ultrasound_clinic_status_created_idx").on(t.clinicId, t.status, t.createdAt),
  index("ultrasound_order_group_idx").on(t.clinicId, t.orderGroupId),
]);

export const insertUltrasoundRecordSchema = createInsertSchema(ultrasoundRecordsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertUltrasoundRecord = z.infer<typeof insertUltrasoundRecordSchema>;
export type UltrasoundRecord = typeof ultrasoundRecordsTable.$inferSelect;
