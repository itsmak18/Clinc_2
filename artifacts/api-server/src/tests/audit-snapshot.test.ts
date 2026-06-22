import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { auditSnapshot, changedFields } from "../lib/audit-snapshot";
import { ENCRYPTED_PHI_FIELDS } from "../lib/phi-fields";

describe("auditSnapshot", () => {
  it("returns null for null/undefined rows", () => {
    expect(auditSnapshot(null)).toBeNull();
    expect(auditSnapshot(undefined)).toBeNull();
  });

  it("redacts encrypted PHI fields to a stable marker", () => {
    const snap = auditSnapshot({
      id: 1,
      fullName: "Jane Roe",
      diagnosis: "enc:v2:1:abc:def:ghi",
      vitals: { bp: "120/80" },
      allergies: "penicillin",
      emergencyContact: "John 555",
      medications: [{ name: "x" }],
    })!;
    expect(snap.diagnosis).toBe("[redacted]");
    expect(snap.vitals).toBe("[redacted]");
    expect(snap.allergies).toBe("[redacted]");
    expect(snap.emergencyContact).toBe("[redacted]");
    expect(snap.medications).toBe("[redacted]");
    // Non-encrypted fields pass through unchanged
    expect(snap.fullName).toBe("Jane Roe");
    expect(snap.id).toBe(1);
  });

  it("keeps null PHI fields as null (no marker)", () => {
    const snap = auditSnapshot({ id: 1, allergies: null })!;
    expect(snap.allergies).toBeNull();
  });

  it("redacts sensitive-but-unencrypted PII (staff home address)", () => {
    const snap = auditSnapshot({
      id: 7,
      fullName: "Jane Roe",
      addressLine: "12 Clinic St",
      city: "Amman",
      region: "Amman Governorate",
      postalCode: "11118",
      country: "Jordan",
    })!;
    expect(snap.addressLine).toBe("[redacted]");
    expect(snap.city).toBe("[redacted]");
    expect(snap.region).toBe("[redacted]");
    expect(snap.postalCode).toBe("[redacted]");
    expect(snap.country).toBe("[redacted]");
    expect(snap.fullName).toBe("Jane Roe");
  });

  it("omits noisy/secret columns", () => {
    const snap = auditSnapshot({
      id: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      clinicId: 2, password: "hash", passwordHash: "hash2", searchVector: "tsv",
      name: "keep",
    })!;
    expect(snap).not.toHaveProperty("createdAt");
    expect(snap).not.toHaveProperty("updatedAt");
    expect(snap).not.toHaveProperty("deletedAt");
    expect(snap).not.toHaveProperty("clinicId");
    expect(snap).not.toHaveProperty("password");
    expect(snap).not.toHaveProperty("passwordHash");
    expect(snap).not.toHaveProperty("searchVector");
    expect(snap.name).toBe("keep");
  });
});

describe("encrypted-PHI redaction drift guard", () => {
  // The audit redactor derives its set from ENCRYPTED_PHI_FIELDS. This test scans
  // the actual service write-sites for `encrypt*( )` assignments so that adding a
  // newly-encrypted column without listing it here fails CI — otherwise its
  // ciphertext would be copied verbatim into audit_logs.beforeState/afterState.
  const SERVICE_FILES = [
    "../services/medical-records.service.ts",
    "../services/patients.service.ts",
    "../services/prescriptions.service.ts",
  ];

  // Matches `diagnosis: encrypt(`, `vitals: encryptJsonNullable(`,
  // `updateData.allergies = encryptNullable(`, etc. Captures the column name
  // (the identifier immediately before the `:` or `=` that precedes encrypt*()).
  const ENCRYPT_ASSIGN = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*encrypt[A-Za-z]*\s*\(/g;

  function encryptedFieldsInSource(): Set<string> {
    const found = new Set<string>();
    for (const rel of SERVICE_FILES) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      for (const m of src.matchAll(ENCRYPT_ASSIGN)) found.add(m[1]);
    }
    return found;
  }

  it("every column encrypted in the service layer is in ENCRYPTED_PHI_FIELDS", () => {
    const declared = new Set<string>(ENCRYPTED_PHI_FIELDS);
    const used = encryptedFieldsInSource();
    // Sanity: the scan actually found the known sites (regex didn't silently break).
    expect(used.size).toBeGreaterThanOrEqual(ENCRYPTED_PHI_FIELDS.length);
    const missing = [...used].filter(f => !declared.has(f));
    expect(missing, `encrypted column(s) not redacted in audit snapshots: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no stale entries — every listed field is actually encrypted somewhere", () => {
    const used = encryptedFieldsInSource();
    const stale = ENCRYPTED_PHI_FIELDS.filter(f => !used.has(f));
    expect(stale, `listed in ENCRYPTED_PHI_FIELDS but no encrypt*() site found: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("changedFields", () => {
  it("lists only differing, non-omitted fields", () => {
    const before = { id: 1, name: "a", phone: "111", updatedAt: new Date(0) };
    const after = { id: 1, name: "b", phone: "111", updatedAt: new Date(1) };
    expect(changedFields(before, after)).toEqual(["name"]);
  });

  it("handles creation (null before) and deletion (null after)", () => {
    expect(changedFields(null, { id: 1, name: "x" })).toContain("name");
    expect(changedFields({ id: 1, name: "x" }, null)).toContain("name");
  });
});
