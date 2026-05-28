// Centralized auth constants — single source of truth for TTLs.
// Co-locating JWT TTL (string for jose) and cookie maxAge (ms) prevents
// silent broken-auth when one is updated without the other.

/** The longest per-role JWT TTL in seconds (4h). Used by revocation stores to bound sweep windows. */
export const MAX_ROLE_TTL_SEC = 4 * 60 * 60;

/** Per-role JWT expiry strings consumed by jose `setExpirationTime`. */
export const ROLE_TTL: Record<string, string> = {
  super_admin:        "15m",
  admin:              "1h",
  doctor:             "2h",
  nurse:              "2h",
  compliance_officer: "2h",
  billing_manager:    "4h",
  front_desk:         "4h",
  xray_staff:         "4h",
  lab_staff:          "4h",
  pharmacist:         "4h",
};

/** Per-role cookie maxAge in milliseconds — must mirror ROLE_TTL exactly. */
export const COOKIE_TTL_MS: Record<string, number> = {
  super_admin:            15 * 60 * 1000,
  admin:              1 * 60 * 60 * 1000,
  doctor:             2 * 60 * 60 * 1000,
  nurse:              2 * 60 * 60 * 1000,
  compliance_officer: 2 * 60 * 60 * 1000,
  billing_manager:    4 * 60 * 60 * 1000,
  front_desk:         4 * 60 * 60 * 1000,
  xray_staff:         4 * 60 * 60 * 1000,
  lab_staff:          4 * 60 * 60 * 1000,
  pharmacist:         4 * 60 * 60 * 1000,
};

// ─── Phase 2: Auth Hardening — Kill Switches ──────────────────────────────────
// Single point of control. When the master flag is OFF every Phase 2 codepath
// must short-circuit so login behavior is byte-identical to today's Phase 1
// system. Each guarded callsite reads via these helpers (never `process.env`
// directly) so the flags can be moved to a config table later without churn.

/** Master switch. When false, every other Phase 2 flag below is also false. */
export const isPhase2Enabled = (): boolean =>
  process.env.PHASE2_DEVICE_TRUST_ENABLED === "true";

/** §2.2/§2.3 — new-device email verification flow. Master flag gates it too. */
export const isEmailVerifyEnabled = (): boolean =>
  isPhase2Enabled() && process.env.PHASE2_EMAIL_VERIFY_ENABLED === "true";

/** §2.7 — re-prompt password on destructive actions. */
export const isStepUpEnabled = (): boolean =>
  isPhase2Enabled() && process.env.PHASE2_STEP_UP_ENABLED === "true";

/** §2.8 — HIBP + 12-char + dictionary policy on new/changed passwords. */
export const isStrictPasswordPolicyEnabled = (): boolean =>
  isPhase2Enabled() && process.env.PHASE2_STRICT_PASSWORD_POLICY === "true";

/** §2.8 — CSP `report-uri` directive + ingestion endpoint. */
export const isCspReportEnabled = (): boolean =>
  isPhase2Enabled() && process.env.PHASE2_CSP_REPORT_ENABLED === "true";
