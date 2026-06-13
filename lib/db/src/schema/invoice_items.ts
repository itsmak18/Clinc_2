import { pgTable, serial, integer, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./billing";
import { servicesCatalogTable } from "./services_catalog";
import { clinicsTable } from "./clinics";

export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  // Nullable: ad-hoc items (no catalog entry) are valid
  serviceId: integer("service_id").references(() => servicesCatalogTable.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("inv_items_invoice_idx").on(t.invoiceId),
  index("inv_items_service_idx").on(t.serviceId),
  index("inv_items_clinic_idx").on(t.clinicId),
]);

export const insertInvoiceItemSchema = createInsertSchema(invoiceItemsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
});

export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;
