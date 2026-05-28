import { pgTable, serial, text, boolean, timestamp, date, pgEnum, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clinicsTable } from "./clinics";

export const genderEnum = pgEnum("gender", ["male", "female"]);

export const patientsTable = pgTable("patients", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1).references(() => clinicsTable.id),
  mrn: text("mrn").notNull().unique(),
  fullName: text("full_name").notNull(),
  fullNameAr: text("full_name_ar"),
  dateOfBirth: date("date_of_birth").notNull(),
  gender: genderEnum("gender").notNull(),
  phone: text("phone").notNull(),
  address: text("address"),
  bloodType: text("blood_type"),
  allergies: text("allergies"),
  emergencyContact: text("emergency_contact"),
  insuranceProvider:   text("insurance_provider"),
  insurancePolicyNum:  text("insurance_policy_num"),
  insuranceMemberId:   text("insurance_member_id"),
  insuranceExpiry:     timestamp("insurance_expiry"),
  insuranceGroupNum:   text("insurance_group_num"),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("patient_phone_idx").on(t.phone),
  index("patient_clinic_idx").on(t.clinicId),
]);

export const insertPatientSchema = createInsertSchema(patientsTable).omit({
  id: true,
  clinicId: true,
  mrn: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
