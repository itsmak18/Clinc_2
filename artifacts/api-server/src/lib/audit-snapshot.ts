/**
 * Pure (db-free) helpers for audit change-history snapshots.
 * Kept separate from audit.ts so they can be unit-tested without importing
 * @workspace/db (which requires DATABASE_URL at module load).
 */
import { ENCRYPTED_PHI_FIELDS } from "./phi-fields";

// Fields that field-encryption.ts encrypts at rest. We must NOT copy their
// cleartext (or meaningless rotating-IV ciphertext) into audit_logs — that would
// create a second cleartext-PHI store or noise. We record only a stable redaction
// marker; the changed-field NAMES still appear in `details.fields`, so compliance
// sees who/when/which-PHI-field-changed without the value leaking. Sourced from
// the single canonical list (phi-fields.ts) so a newly-encrypted column is
// redacted automatically; the drift guard in tests/audit-snapshot.test.ts fails
// CI if a service encrypts a column that is missing from that list.
const AUDIT_PHI_REDACT_FIELDS = new Set<string>(ENCRYPTED_PHI_FIELDS);
// Sensitive-but-unencrypted PII that we still don't want copied verbatim into
// audit_logs.beforeState/afterState. Unlike the PHI set above these columns are
// NOT encrypted at rest (so they don't belong in phi-fields.ts), but a staff
// member's home address is personal data — we record only a stable redaction
// marker; the changed-field NAMES still surface via `details.fields`.
const AUDIT_SENSITIVE_REDACT_FIELDS = new Set<string>([
  "addressLine", "city", "region", "postalCode", "country", // users — home address
]);
// Everything that gets the "[redacted]" treatment inside a snapshot.
const AUDIT_REDACT_FIELDS = new Set<string>([
  ...AUDIT_PHI_REDACT_FIELDS,
  ...AUDIT_SENSITIVE_REDACT_FIELDS,
]);
// Low-signal/noisy columns excluded from before→after diffs.
const AUDIT_SNAPSHOT_OMIT_FIELDS = new Set([
  "createdAt", "updatedAt", "deletedAt", "clinicId", "searchVector", "password", "passwordHash",
]);

/**
 * Build a sanitized snapshot of a DB row for audit beforeState/afterState.
 * Encrypted PHI + sensitive PII fields → "[redacted]"; noise columns dropped.
 * Returns null for a null/undefined row (e.g. a creation's "before" or a
 * hard-delete's "after").
 */
export function auditSnapshot(
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (row == null) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (AUDIT_SNAPSHOT_OMIT_FIELDS.has(k)) continue;
    out[k] = AUDIT_REDACT_FIELDS.has(k) ? (v == null ? null : "[redacted]") : v;
  }
  return out;
}

/** Field names that differ between two raw rows — used for `details.fields`. */
export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (AUDIT_SNAPSHOT_OMIT_FIELDS.has(k)) continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
  }
  return changed;
}
