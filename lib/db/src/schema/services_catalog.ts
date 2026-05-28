import { pgTable, serial, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const servicesCatalogTable = pgTable("services_catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  defaultPrice: numeric("default_price", { precision: 10, scale: 2 }).notNull(),
  category: text("category"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertServiceCatalogSchema = createInsertSchema(servicesCatalogTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertServiceCatalog = z.infer<typeof insertServiceCatalogSchema>;
export type ServiceCatalog = typeof servicesCatalogTable.$inferSelect;
