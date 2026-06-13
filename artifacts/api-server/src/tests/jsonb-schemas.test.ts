/**
 * jsonb-schemas.test.ts
 *
 * Unit tests for the centralised JSONB guard schemas.
 * Covers: valid payloads, boundary values, extra keys (strict rejection),
 * empty arrays, and missing required fields.
 */
import { describe, it, expect } from "vitest";
import { vitalsSchema, medicationsSchema, staffAssignedSchema, itemsSchema } from "../lib/jsonb-schemas";

// ── vitalsSchema ──────────────────────────────────────────────────────────────

describe("vitalsSchema", () => {
  it("accepts undefined (nullable column)", () => {
    expect(vitalsSchema.safeParse(undefined).success).toBe(true);
  });

  it("accepts empty object (all fields optional)", () => {
    expect(vitalsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a fully populated valid object", () => {
    expect(vitalsSchema.safeParse({
      bloodPressureSystolic: 120,
      bloodPressureDiastolic: 80,
      heartRate: 72,
      temperature: 37.0,
      oxygenSaturation: 98,
      respiratoryRate: 16,
      weight: 75,
      height: 175,
    }).success).toBe(true);
  });

  it("accepts a partial object", () => {
    expect(vitalsSchema.safeParse({ heartRate: 80 }).success).toBe(true);
  });

  it("rejects extra/unknown keys (strict mode)", () => {
    expect(vitalsSchema.safeParse({ heartRate: 80, diagnosisNotes: "sneaked in" }).success).toBe(false);
  });

  it("rejects out-of-range bloodPressureSystolic (below min)", () => {
    expect(vitalsSchema.safeParse({ bloodPressureSystolic: 10 }).success).toBe(false);
  });

  it("rejects out-of-range bloodPressureSystolic (above max)", () => {
    expect(vitalsSchema.safeParse({ bloodPressureSystolic: 400 }).success).toBe(false);
  });

  it("rejects temperature below physiological range", () => {
    expect(vitalsSchema.safeParse({ temperature: 20 }).success).toBe(false);
  });

  it("rejects oxygenSaturation above 100", () => {
    expect(vitalsSchema.safeParse({ oxygenSaturation: 101 }).success).toBe(false);
  });

  it("rejects string values for numeric fields", () => {
    expect(vitalsSchema.safeParse({ heartRate: "fast" }).success).toBe(false);
  });

  // Boundary values
  it("accepts heartRate at min boundary (20)", () => {
    expect(vitalsSchema.safeParse({ heartRate: 20 }).success).toBe(true);
  });

  it("accepts heartRate at max boundary (300)", () => {
    expect(vitalsSchema.safeParse({ heartRate: 300 }).success).toBe(true);
  });

  it("rejects heartRate at max+1 (301)", () => {
    expect(vitalsSchema.safeParse({ heartRate: 301 }).success).toBe(false);
  });
});

// ── medicationsSchema ─────────────────────────────────────────────────────────

describe("medicationsSchema", () => {
  // Field names MUST match the API contract + every reader (F-P5-5): the frontend
  // form, OpenAPI CreatePrescriptionBody, print.ts and DischargeSheet all use
  // `dosage` / `instructions`. The earlier `dose` / `route` shape this suite used
  // to assert was the bug — it rejected every real create.
  const validMed = { name: "Amoxicillin", dosage: "500mg", frequency: "3x daily" };

  it("accepts a valid single medication", () => {
    expect(medicationsSchema.safeParse([validMed]).success).toBe(true);
  });

  it("accepts the exact frontend/OpenAPI shape (name, dosage, frequency, duration, instructions)", () => {
    // This is the payload Prescriptions.tsx sends — pre-F-P5-5 it was rejected.
    expect(
      medicationsSchema.safeParse([
        { name: "Amoxicillin", dosage: "500mg", frequency: "3x daily", duration: "7 days", instructions: "after food" },
      ]).success,
    ).toBe(true);
  });

  it("accepts multiple medications", () => {
    expect(medicationsSchema.safeParse([validMed, { name: "Ibuprofen", dosage: "400mg", frequency: "twice daily" }]).success).toBe(true);
  });

  it("accepts optional fields (duration, instructions)", () => {
    expect(medicationsSchema.safeParse([{ ...validMed, duration: "7 days", instructions: "oral" }]).success).toBe(true);
  });

  it("rejects empty array (min 1)", () => {
    expect(medicationsSchema.safeParse([]).success).toBe(false);
  });

  it("rejects medication missing name", () => {
    expect(medicationsSchema.safeParse([{ dosage: "500mg", frequency: "daily" }]).success).toBe(false);
  });

  it("rejects medication missing dosage", () => {
    expect(medicationsSchema.safeParse([{ name: "Drug", frequency: "daily" }]).success).toBe(false);
  });

  it("rejects medication missing frequency", () => {
    expect(medicationsSchema.safeParse([{ name: "Drug", dosage: "10mg" }]).success).toBe(false);
  });

  it("rejects the legacy dose/route shape (regression guard for F-P5-5)", () => {
    expect(medicationsSchema.safeParse([{ name: "Drug", dose: "10mg", frequency: "daily", route: "oral" }]).success).toBe(false);
  });

  it("rejects extra/unknown keys (strict mode)", () => {
    expect(medicationsSchema.safeParse([{ ...validMed, sideEffects: "hidden field" }]).success).toBe(false);
  });

  it("rejects non-array input", () => {
    expect(medicationsSchema.safeParse(validMed).success).toBe(false);
  });

  it("rejects null", () => {
    expect(medicationsSchema.safeParse(null).success).toBe(false);
  });

  it("rejects medication with empty name string", () => {
    expect(medicationsSchema.safeParse([{ name: "", dosage: "10mg", frequency: "daily" }]).success).toBe(false);
  });
});

// ── staffAssignedSchema ───────────────────────────────────────────────────────

describe("staffAssignedSchema", () => {
  it("accepts empty array (no staff yet)", () => {
    expect(staffAssignedSchema.safeParse([]).success).toBe(true);
  });

  it("accepts valid staff entry with userId only", () => {
    expect(staffAssignedSchema.safeParse([{ userId: 5 }]).success).toBe(true);
  });

  it("accepts valid staff entry with optional role", () => {
    expect(staffAssignedSchema.safeParse([{ userId: 5, role: "anesthesiologist" }]).success).toBe(true);
  });

  it("accepts multiple staff members", () => {
    expect(staffAssignedSchema.safeParse([
      { userId: 1, role: "surgeon" },
      { userId: 2, role: "scrub_nurse" },
      { userId: 3 },
    ]).success).toBe(true);
  });

  it("rejects entry missing userId", () => {
    expect(staffAssignedSchema.safeParse([{ role: "nurse" }]).success).toBe(false);
  });

  it("rejects non-positive userId", () => {
    expect(staffAssignedSchema.safeParse([{ userId: 0 }]).success).toBe(false);
    expect(staffAssignedSchema.safeParse([{ userId: -1 }]).success).toBe(false);
  });

  it("rejects extra/unknown keys (strict mode)", () => {
    expect(staffAssignedSchema.safeParse([{ userId: 1, permissions: "admin" }]).success).toBe(false);
  });

  it("rejects non-array input", () => {
    expect(staffAssignedSchema.safeParse({ userId: 1 }).success).toBe(false);
  });
});

// ── itemsSchema (invoice line items) ──────────────────────────────────────────

describe("itemsSchema (invoice line items)", () => {
  const validItem = { description: "Consultation fee", quantity: 1, unitPrice: 50.00 };

  it("accepts a single valid line item", () => {
    expect(itemsSchema.safeParse([validItem]).success).toBe(true);
  });

  it("accepts multiple line items", () => {
    expect(itemsSchema.safeParse([validItem, { description: "X-ray", quantity: 2, unitPrice: 30 }]).success).toBe(true);
  });

  it("accepts unitPrice of zero (free item)", () => {
    expect(itemsSchema.safeParse([{ description: "Sample item", quantity: 1, unitPrice: 0 }]).success).toBe(true);
  });

  it("rejects empty array (invoice must have at least one item)", () => {
    expect(itemsSchema.safeParse([]).success).toBe(false);
  });

  it("rejects negative unitPrice", () => {
    expect(itemsSchema.safeParse([{ ...validItem, unitPrice: -1 }]).success).toBe(false);
  });

  it("rejects non-integer quantity", () => {
    expect(itemsSchema.safeParse([{ ...validItem, quantity: 1.5 }]).success).toBe(false);
  });

  it("rejects zero quantity", () => {
    expect(itemsSchema.safeParse([{ ...validItem, quantity: 0 }]).success).toBe(false);
  });

  it("rejects empty description", () => {
    expect(itemsSchema.safeParse([{ ...validItem, description: "" }]).success).toBe(false);
  });

  it("rejects extra/unknown keys (strict mode)", () => {
    expect(itemsSchema.safeParse([{ ...validItem, taxRate: 0.1 }]).success).toBe(false);
  });

  it("rejects non-array input", () => {
    expect(itemsSchema.safeParse(validItem).success).toBe(false);
  });
});
