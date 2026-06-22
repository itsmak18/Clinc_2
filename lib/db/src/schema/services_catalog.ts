import { pgTable, serial, text, numeric, boolean, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clinicsTable } from "./clinics";

export const servicesCatalogTable = pgTable("services_catalog", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  description: text("description"),
  descriptionAr: text("description_ar"),
  defaultPrice: numeric("default_price", { precision: 10, scale: 2 }).notNull(),
  category: text("category"),
  // Stable identifier used by charge auto-generation to map a clinical event to a
  // price (e.g. CONSULTATION, LAB_DEFAULT, XRAY_DEFAULT). Optional.
  code: text("code"),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("services_catalog_clinic_idx").on(t.clinicId),
]);

export const insertServiceCatalogSchema = createInsertSchema(servicesCatalogTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertServiceCatalog = z.infer<typeof insertServiceCatalogSchema>;
export type ServiceCatalog = typeof servicesCatalogTable.$inferSelect;
