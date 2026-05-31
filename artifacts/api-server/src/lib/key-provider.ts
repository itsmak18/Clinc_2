/**
 * Pluggable key-provider abstraction for PHI field encryption.
 *
 * Phase 4.4 scaffolding (2026-05-31). The board review (2026-05-30) called out
 * the single field-encryption DEK living on the app host as a HIPAA-grade
 * weakness: losing the key = losing all PHI; the audit trail of "who unwrapped
 * the key" lives nowhere; rotation requires re-keying the app environment.
 *
 * The standard fix is envelope encryption with the master key in a cloud HSM/KMS
 * (AWS KMS, GCP KMS, Azure Key Vault). This module defines the seam that
 * makes that swap a one-line change in field-encryption.ts when the cloud
 * deployment lands (Phase 4.1/4.4 actual rollout).
 *
 * Today the only implementation is `LocalEnvKeyProvider`, which preserves the
 * current behavior: AES keys are read from FIELD_ENCRYPTION_KEY +
 * FIELD_ENCRYPTION_KEY_NEXT env vars at process start. A future
 * `AwsKmsKeyProvider` / `GcpKmsKeyProvider` / `AzureKeyVaultProvider` would
 * implement the same interface — each call to `getDataKey(kid)` becomes a
 * cached `kms:Decrypt` API call against the encrypted DEK blob fetched at
 * boot. Rotation = generate a new wrapped DEK, register as kid=2, flip
 * KEY_WRITE_KID — same procedure as today, but the wrap/unwrap happens in
 * the HSM, not on disk.
 *
 * Why this is scaffolding-only: the cloud impl needs (a) a cloud account with
 * BAA, (b) IAM roles, (c) test fixtures for end-to-end verification. None of
 * those are in scope for a code PR. The abstraction lands now so the eventual
 * KMS migration is a documented two-day task instead of a re-architecture.
 */

export interface KeyProvider {
  /**
   * Returns the raw 32-byte AES-256 key for the given kid, or undefined if no
   * key is registered for that kid.
   *
   * The interface is synchronous because today's local-env impl is sync, and
   * the v2 envelope decode happens on the hot path of every PHI read.
   * KMS-backed impls will memoize the unwrapped DEK in-process at startup;
   * if a KMS call is ever needed inside this method, the interface becomes
   * `Promise<Buffer>` and decrypt-call sites become async — a follow-up.
   */
  getDataKey(kid: string): Buffer | undefined;

  /**
   * Returns the kid that new writes should use. Today the field-encryption
   * module reads FIELD_ENCRYPTION_KEY_WRITE_KID directly; a KMS impl can vary
   * this per-tenant or per-classification as Phase 6 rolls in per-tenant DEKs.
   */
  getActiveWriteKid(): string;

  /**
   * Identity string for /metrics + RUNBOOK introspection. Lets the team verify
   * "what is actually keying production right now" without parsing env vars.
   */
  readonly name: string;
}

/**
 * Today's implementation: AES keys come from FIELD_ENCRYPTION_KEY (kid=1) and
 * the optional FIELD_ENCRYPTION_KEY_NEXT (kid=2). Behavior is identical to the
 * pre-4.4 field-encryption.ts; this class just makes the source of keys
 * explicit so other providers can slot in later.
 */
export class LocalEnvKeyProvider implements KeyProvider {
  readonly name = "local-env";
  private readonly keys = new Map<string, Buffer>();
  private readonly writeKid: string;

  constructor(opts: {
    primaryHex?: string;
    nextHex?: string;
    writeKid?: string;
  }) {
    this.registerHex("1", opts.primaryHex);
    this.registerHex("2", opts.nextHex);
    this.writeKid = opts.writeKid ?? "1";
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(this.writeKid)) {
      throw new Error(`writeKid must be a short alphanumeric string — got: ${this.writeKid}`);
    }
  }

  private registerHex(kid: string, raw: string | undefined): void {
    if (!raw) return;
    if (!/^[0-9a-f]{64}$/i.test(raw)) {
      throw new Error(`Key for kid=${kid} must be exactly 64 hex chars (256-bit AES)`);
    }
    this.keys.set(kid, Buffer.from(raw, "hex"));
  }

  getDataKey(kid: string): Buffer | undefined {
    return this.keys.get(kid);
  }

  getActiveWriteKid(): string {
    return this.writeKid;
  }
}

/**
 * Stub for the cloud-KMS provider. Throws on construction — the cloud impl is
 * not wired in this PR. The class exists so that the migration is a Find+Edit
 * exercise in field-encryption.ts (replace `new LocalEnvKeyProvider(...)` with
 * the cloud variant), not a re-architecture.
 *
 * When the cloud deployment lands (Phase 4.1/4.4):
 *   1. Choose a vendor (AWS KMS, GCP Cloud KMS, Azure Key Vault).
 *   2. Replace this class body with a real impl that:
 *        - On construction, calls kms:Decrypt against the wrapped-DEK blob
 *          stored in Secrets Manager / similar, populates an in-process Map.
 *        - On rotation, register the next wrapped DEK as kid=2 and flip
 *          FIELD_ENCRYPTION_KEY_WRITE_KID.
 *   3. In field-encryption.ts, swap `LocalEnvKeyProvider` → `KmsKeyProvider`.
 *   4. Remove FIELD_ENCRYPTION_KEY / _NEXT from secrets/ (the raw DEK no
 *      longer lives outside the HSM).
 *   5. Document the kms:Decrypt CloudTrail/audit log review cadence in RUNBOOK.
 */
export class KmsKeyProvider implements KeyProvider {
  readonly name = "kms-stub";
  constructor() {
    throw new Error(
      "KmsKeyProvider is a stub — implement the chosen cloud-KMS integration " +
      "before instantiating. See lib/key-provider.ts comment for the rollout playbook.",
    );
  }
  getDataKey(_kid: string): Buffer | undefined { return undefined; }
  getActiveWriteKid(): string { return "1"; }
}
