import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The clinics table is the FK target for `clinic_id` on every PHI table.
// Plan item E1 adds the column with DEFAULT 1 across PHI tables now so the
// future migration to true multi-tenancy is a service-layer change, not a
// destructive schema migration on a populated PHI database.
//
// A single seed row (id=1, name="Default Clinic") satisfies the FK for every
// existing row; the seed script inserts it idempotently before any other PHI.
//
// SCOPE NOTE: this PR adds clinic_id only to the strict-PHI tables + audit_logs.
// Operational tables that should also be clinic-scoped (users, inventory,
// doctor_schedules, services_catalog) are intentionally deferred to a follow-up
// PR — keeps each migration small and the blast radius contained.
export const clinicsTable = pgTable("clinics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertClinicSchema = createInsertSchema(clinicsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertClinic = z.infer<typeof insertClinicSchema>;
export type Clinic = typeof clinicsTable.$inferSelect;
