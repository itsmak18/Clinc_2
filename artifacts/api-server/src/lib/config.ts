/**
 * Typed configuration — single place that reads process.env.
 * All other source files must import from here (enforced by ESLint).
 * Fail-fast: required production secrets are checked at boot-up by their
 * consuming modules (jwt-secret.ts, field-encryption.ts) which already
 * throw if the key is absent in production — those modules may read config
 * through this file or directly (they are the security boundary).
 */

function envStr(key: string, def: string): string {
  return process.env[key] ?? def;
}

function envStrOpt(key: string): string | undefined {
  return process.env[key];
}

function envNum(key: string, def: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function envNumOpt(key: string): number | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function envBool(key: string, def: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return def;
  return raw === "true";
}

const isTest = process.env["NODE_ENV"] === "test";

export const config = {
  // ── Runtime ──────────────────────────────────────────────────────────────
  nodeEnv:      envStr("NODE_ENV", "development") as "development" | "test" | "production",
  isProd:       process.env["NODE_ENV"] === "production",
  isDev:        process.env["NODE_ENV"] !== "production" && process.env["NODE_ENV"] !== "test",
  isTest,
  port:         envNum("PORT", 5000),

  // ── Database / session ────────────────────────────────────────────────────
  databaseUrl:  envStr("DATABASE_URL", ""),
  sessionStore: envStr("SESSION_STORE", process.env["NODE_ENV"] === "production" ? "redis" : "memory") as "memory" | "redis",
  redisUrl:     envStr("REDIS_URL", "redis://localhost:6379"),

  // ── CORS ─────────────────────────────────────────────────────────────────
  allowedOrigins: envStr("ALLOWED_ORIGINS", ""),

  // ── Observability ─────────────────────────────────────────────────────────
  metricsToken: envStrOpt("METRICS_TOKEN"),
  logLevel:     envStr("LOG_LEVEL", "info"),
  otelEndpoint: envStrOpt("OTEL_EXPORTER_OTLP_ENDPOINT"),
  otelHeaders:  envStr("OTEL_EXPORTER_OTLP_HEADERS", ""),

  // ── Auth / fingerprint ────────────────────────────────────────────────────
  fingerprintBinding:     envStr("FINGERPRINT_BINDING", ""),
  // AUD-SEC-07: in production `FINGERPRINT_BINDING=disabled` is only honored while
  // now < this unix-seconds expiry (fingerprint-lever.ts enforces it live). Kept
  // here for documentation/typed-surface parity; the lever reads env directly for
  // test mutability, same as checkMetricsAuth.
  fingerprintBindingExpiresAt: envNum("FINGERPRINT_BINDING_EXPIRES_AT", 0),
  fphGrandfatherUntil:    envNum("FPH_GRANDFATHER_UNTIL", 0),
  revocationReadGraceMs:  envNum("REVOCATION_READ_GRACE_MS", 30_000),

  // ── JWT / session secret ──────────────────────────────────────────────────
  sessionSecret:    envStrOpt("SESSION_SECRET"),
  jwtKid:           envStr("JWT_KID", "1"),
  jwtPrevKid:       envStr("JWT_PREV_KID", "0"),
  jwtPrivateKey:    envStrOpt("JWT_PRIVATE_KEY"),
  jwtPublicKey:     envStrOpt("JWT_PUBLIC_KEY"),
  jwtPrevPublicKey: envStrOpt("JWT_PREV_PUBLIC_KEY"),

  // ── PHI field encryption ──────────────────────────────────────────────────
  fieldEncryptionKey:       envStrOpt("FIELD_ENCRYPTION_KEY"),
  fieldEncryptionKeyNext:   envStrOpt("FIELD_ENCRYPTION_KEY_NEXT"),
  fieldEncryptionKeyWriteKid: envStr("FIELD_ENCRYPTION_KEY_WRITE_KID", "1"),

  // ── SSE ───────────────────────────────────────────────────────────────────
  sseDrainMs:           envNumOpt("SSE_DRAIN_MS") ?? (isTest ? 0 : 10_000),
  sseMaxConnections:    envNum("SSE_MAX_CONNECTIONS", 500),
  sseMaxPerUser:        envNum("SSE_MAX_PER_USER", 10),
  sseReplayBuffer:      envNum("SSE_REPLAY_BUFFER", 50),

  // ── Shutdown ──────────────────────────────────────────────────────────────
  shutdownTimeoutMs:   envNumOpt("SHUTDOWN_TIMEOUT_MS") ?? (isTest ? 2_000 : 30_000),
  shutdownDrainGraceMs: envNumOpt("SHUTDOWN_DRAIN_GRACE_MS") ?? (isTest ? 50 : 3_000),

  // ── Password ──────────────────────────────────────────────────────────────
  bcryptRounds: envNum("BCRYPT_ROUNDS", 12),

  // ── Localisation ──────────────────────────────────────────────────────────
  clinicTz: envStr("CLINIC_TZ", "Europe/Istanbul"),

  // ── Audit ─────────────────────────────────────────────────────────────────
  auditVerifyWindowDays:    envNum("AUDIT_VERIFY_WINDOW_DAYS", 7),
  cspReportRetentionDays:   envNum("CSP_REPORT_RETENTION_DAYS", 90),
  imagingOrphanGraceHours:  envNum("IMAGING_ORPHAN_GRACE_HOURS", 24),
  backupRetentionDays:      envNum("BACKUP_RETENTION_DAYS", 7),

  // ── Imaging ───────────────────────────────────────────────────────────────
  imagingStorageDir:       envStrOpt("IMAGING_STORAGE_DIR"),
  imagingClinicQuotaBytes: envNum("IMAGING_CLINIC_QUOTA_BYTES", 0),

  // ── Break-glass ───────────────────────────────────────────────────────────
  breakGlassAuditFallbackDir: envStr("BREAK_GLASS_AUDIT_FALLBACK_DIR", "./storage/break-glass-audit"),
  bgVelocityThreshold:        envNum("BG_VELOCITY_THRESHOLD", 3),

  // ── Audit outbox durability (AUD-SEAM-01) ─────────────────────────────────
  auditOutboxFallbackDir: envStr("AUDIT_OUTBOX_FALLBACK_DIR", "./storage/audit-outbox"),

  // ── Worker metrics endpoint (AUD-OPS-04) ──────────────────────────────────
  workerMetricsPort: envNum("WORKER_METRICS_PORT", 5001),

  // ── Workflow ──────────────────────────────────────────────────────────────
  autoAdvanceFlow: process.env["AUTO_ADVANCE_FLOW"] !== "false",

  // ── Financial clearance gate (Phase A) ────────────────────────────────────
  // OFF (default): order creation/progress behaves exactly as before the gate
  // existed. ON: lab/xray/ultrasound orders are created clearance_status=pending
  // with an auto-charge on the patient's basket invoice; workflow progress is
  // blocked until the basket is paid or a clinical emergency override clears it.
  clearanceGateEnabled: envBool("CLEARANCE_GATE_ENABLED", false),
  clearanceTtlHours:    envNum("CLEARANCE_TTL_HOURS", 48),

  // ── Phase 2 auth flags (read via auth-constants.ts helpers) ──────────────
  phase2DeviceTrustEnabled:     envBool("PHASE2_DEVICE_TRUST_ENABLED", false),
  phase2EmailVerifyEnabled:     envBool("PHASE2_EMAIL_VERIFY_ENABLED", false),
  phase2StepUpEnabled:          envBool("PHASE2_STEP_UP_ENABLED", false),
  phase2StrictPasswordPolicy:   envBool("PHASE2_STRICT_PASSWORD_POLICY", false),
  phase2CspReportEnabled:       envBool("PHASE2_CSP_REPORT_ENABLED", false),

  // ── Email (Phase 2) ───────────────────────────────────────────────────────
  resendApiKey:       envStrOpt("RESEND_API_KEY"),
  emailFromAddress:   envStr("EMAIL_FROM_ADDRESS", "Wateen Clinic <no-reply@medicore.local>"),
  appPublicUrl:       envStrOpt("APP_PUBLIC_URL"),

  // ── SMS (Phase 2) ─────────────────────────────────────────────────────────
  smsProvider:        envStrOpt("SMS_PROVIDER"),
  twilioAccountSid:   envStrOpt("TWILIO_ACCOUNT_SID"),
  twilioAuthToken:    envStrOpt("TWILIO_AUTH_TOKEN"),
  twilioFromNumber:   envStrOpt("TWILIO_FROM_NUMBER"),

  // ── DB pool ───────────────────────────────────────────────────────────────
  dbPoolMax:              envNum("DB_POOL_MAX", 40),
  dbPoolMin:              envNum("DB_POOL_MIN", 2),
  dbPoolIdleTimeout:      envNum("DB_POOL_IDLE_TIMEOUT", 30_000),
  dbPoolConnectTimeout:   envNum("DB_POOL_CONNECT_TIMEOUT", 5_000),
  dbStatementTimeout:     envNum("DB_STATEMENT_TIMEOUT", 30_000),
} as const;
