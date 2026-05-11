import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";

export const ultrasoundStatusEnum = pgEnum("ultrasound_status", ["pending", "uploaded", "reviewed"]);

export const ultrasoundRecordsTable = pgTable("ultrasound_records", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  requestedById: integer("requested_by_id").notNull().references(() => usersTable.id),
  performedById: integer("performed_by_id").references(() => usersTable.id),
  examType: text("exam_type").notNull(),
  bodyPart: text("body_part").notNull(),
  imageUrl: text("image_url"),
  imageFileName: text("image_file_name"),
  report: text("report"),
  status: ultrasoundStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUltrasoundRecordSchema = createInsertSchema(ultrasoundRecordsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertUltrasoundRecord = z.infer<typeof insertUltrasoundRecordSchema>;
export type UltrasoundRecord = typeof ultrasoundRecordsTable.$inferSelect;
