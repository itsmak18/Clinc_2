/**
 * Single source of truth for the column names that `field-encryption.ts`
 * encrypts at rest (AES-256-GCM). Pure (no imports) so it can be shared by the
 * crypto layer, the db-free audit-snapshot redactor, and tests without dragging
 * in @workspace/db or the key registry.
 *
 * INVARIANT: if you add (or remove) an `encrypt*()` call on a new column at a
 * service write-site, update this list in the SAME change. The audit redactor
 * (`audit-snapshot.ts`) derives its redaction set from here, so a miss would
 * otherwise copy ciphertext PHI into `audit_logs`. The drift guard in
 * `tests/audit-snapshot.test.ts` scans the service layer and fails CI if a
 * field is encrypted but not listed here.
 */
export const ENCRYPTED_PHI_FIELDS = [
  "diagnosis",        // medical_records
  "vitals",           // medical_records
  "medications",      // prescriptions
  "allergies",        // patients
  "emergencyContact", // patients
] as const;

export type EncryptedPhiField = (typeof ENCRYPTED_PHI_FIELDS)[number];
