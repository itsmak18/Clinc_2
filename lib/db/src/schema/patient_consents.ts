import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { clinicsTable } from "./clinics";

export const consentTypeEnum = pgEnum("consent_type", [
  "treatment",    // consent to receive medical care — required before creating records/prescriptions
  "data_sharing", // consent to share PHI with external parties (labs, specialists, insurers)
  "research",     // consent to include anonymized data in research studies
  "marketing",    // consent to receive non-clinical communications
]);

export const patientConsentsTable = pgTable("patient_consents", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  consentType: consentTypeEnum("consent_type").notNull(),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  grantedByUserId: integer("granted_by_user_id").notNull().references(() => usersTable.id),
  ipAddress: text("ip_address").notNull(),
  documentVersion: text("document_version").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("consent_patient_idx").on(t.patientId),
  index("consent_patient_type_idx").on(t.patientId, t.consentType),
  index("consent_clinic_idx").on(t.clinicId),
]);

export const insertConsentSchema = createInsertSchema(patientConsentsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertConsent = z.infer<typeof insertConsentSchema>;
export type PatientConsent = typeof patientConsentsTable.$inferSelect;
