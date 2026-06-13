import { pgTable, serial, text, boolean, timestamp, pgEnum, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin",
  "doctor",
  "nurse",
  "front_desk",
  "xray_staff",
  "lab_staff",
  "compliance_officer",
  "billing_manager",
  "pharmacist",
]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  fullNameAr: text("full_name_ar"),
  email: text("email"),
  clinicId: integer("clinic_id").notNull(),
  role: userRoleEnum("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isOnShift: boolean("is_on_shift").notNull().default(false),
  phone: text("phone"),
  specialty: text("specialty"),
  department: text("department"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
