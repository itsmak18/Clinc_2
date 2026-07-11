import { pgTable, serial, text, integer, timestamp, numeric, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

export const invoiceStatusEnum = pgEnum("invoice_status", ["pending", "paid", "cancelled"]);

// manual — staff-created invoice (POS / ad-hoc). order_basket — system-created
// per-patient basket that accumulates auto-charges from clinical orders; at most
// one OPEN basket per patient (enforced by invoice_open_basket_uq below).
export const invoiceKindEnum = pgEnum("invoice_kind", ["manual", "order_basket"]);

// Financial clearance of a clinical order (lab/xray/ultrasound) — orthogonal to
// the order's workflow status. pending — awaiting payment, workflow progress
// blocked. cleared — basket invoice paid. overridden — emergency clearance
// (audited; invoice stays pending). expired — never paid within TTL, or its
// basket was cancelled; workflow progress blocked permanently.
export const clearanceStatusEnum = pgEnum("clearance_status", ["pending", "cleared", "overridden", "expired"]);

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  invoiceNumber: text("invoice_number").notNull().unique(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  kind: invoiceKindEnum("kind").notNull().default("manual"),
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
  index("invoice_clinic_patient_created_idx").on(t.clinicId, t.patientId, t.createdAt),
  index("invoice_clinic_status_created_idx").on(t.clinicId, t.status, t.createdAt),
  // Concurrency backstop for findOrCreateBasket: at most one open order basket
  // per patient. Concurrent creators race on this and the loser re-selects.
  uniqueIndex("invoice_open_basket_uq").on(t.clinicId, t.patientId)
    .where(sql`kind = 'order_basket' AND status = 'pending' AND deleted_at IS NULL`),
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
