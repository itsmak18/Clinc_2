import { pgTable, serial, text, integer, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";

export const operationStatusEnum = pgEnum("operation_status", [
  "requested",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

export const operationsTable = pgTable("operations", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  surgeonId: integer("surgeon_id").notNull().references(() => usersTable.id),
  // Who created/requested this operation (the signed-in user). Distinct from the
  // surgeon — a referring doctor or admin may schedule for a different surgeon.
  requestedById: integer("requested_by_id").references(() => usersTable.id),
  procedureName: text("procedure_name").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  operatingRoom: text("operating_room").notNull(),
  status: operationStatusEnum("status").notNull().default("scheduled"),
  staffAssigned: jsonb("staff_assigned").notNull().default("[]"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOperationSchema = createInsertSchema(operationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertOperation = z.infer<typeof insertOperationSchema>;
export type Operation = typeof operationsTable.$inferSelect;
