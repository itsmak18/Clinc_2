/**
 * jsonb-schemas.ts
 *
 * Centralised Zod schemas for every JSONB column in the database.
 * Import these guards into route handlers BEFORE any db.insert / db.update.
 *
 * RULE: Never write to a JSONB column without validating against these schemas.
 *
 * Columns covered:
 *  - vitals         → medical_records.vitals
 *  - medications    → prescriptions.medications  (array)
 *  - staffAssigned  → operations.staffAssigned   (array of user refs)
 */
import { z } from "zod/v4";

// ── vitals ────────────────────────────────────────────────────────────────────
// Stored on medical_records.vitals (jsonb, nullable).
// All fields optional — partial vitals are valid.
export const vitalsSchema = z
  .object({
    bloodPressureSystolic:  z.number().int().min(50).max(300),
    bloodPressureDiastolic: z.number().int().min(30).max(200),
    heartRate:              z.number().int().min(20).max(300),
    temperature:            z.number().min(30).max(45),
    oxygenSaturation:       z.number().min(50).max(100),
    respiratoryRate:        z.number().int().min(5).max(60),
    weight:                 z.number().min(0.5).max(500),
    height:                 z.number().min(20).max(250),
  })
  .partial()
  .strict()  // Reject unknown keys — prevents PHI injection via extra fields
  .optional();

export type Vitals = z.infer<typeof vitalsSchema>;

// ── medications ───────────────────────────────────────────────────────────────
// Stored on prescriptions.medications (jsonb, array).
// Each medication must have name, dose, frequency.
// duration and route are optional clinical additions.
export const medicationItemSchema = z
  .object({
    name:      z.string().min(1).max(200),
    dose:      z.string().min(1).max(100),
    frequency: z.string().min(1).max(100),
    duration:  z.string().max(100).optional(),
    route:     z.string().max(50).optional(),  // e.g. oral, IV, topical
  })
  .strict();

export const medicationsSchema = z
  .array(medicationItemSchema)
  .min(1, "At least one medication is required")
  .max(50, "Too many medications in a single prescription");

export type Medication = z.infer<typeof medicationItemSchema>;

// ── staffAssigned ─────────────────────────────────────────────────────────────
// Stored on operations.staffAssigned (jsonb, array of user references).
// Must be an array (empty is valid — OR scheduled without staff yet).
export const staffAssignedItemSchema = z
  .object({
    userId: z.number().int().positive(),
    role:   z.string().min(1).max(50).optional(),  // e.g. "anesthesiologist", "scrub_nurse"
  })
  .strict();

export const staffAssignedSchema = z
  .array(staffAssignedItemSchema)
  .max(20, "Too many staff assigned to a single operation");

export type StaffAssignedItem = z.infer<typeof staffAssignedItemSchema>;
