import { pgTable, serial, text, integer, timestamp, numeric, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

export const invoiceStatusEnum = pgEnum("invoice_status", ["pending", "paid", "cancelled"]);

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1).references(() => clinicsTable.id),
  invoiceNumber: text("invoice_number").notNull().unique(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("invoice_patient_idx").on(t.patientId),
  index("invoice_status_idx").on(t.status),
  index("invoice_created_idx").on(t.createdAt),
  index("invoice_clinic_idx").on(t.clinicId),
]);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  clinicId: true,
  invoiceNumber: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
