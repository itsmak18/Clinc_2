# MediCore Security Policy & Threat Model

## Threat Model

The MediCore platform is designed to handle Protected Health Information (PHI) and is built with a defense-in-depth approach.

### Key Security Invariants

1.  **Centralized RBAC:** All API routes enforce Role-Based Access Control (RBAC). The `super_admin` role bypasses role arrays but NOT state machine invariants or data-scoping rules.
2.  **Strict Data Scoping:** Doctors can only access patient data — medical records, prescriptions, lab/x-ray/ultrasound results, vitals, and appointments — for patients they have a treating relationship with (an appointment assigned to them). The only exception is an active **break-glass** session (read-only, fully audited). There is no "global record" escape hatch — the `isGlobal`/`globalReason` flags were removed in migration 0011.
3.  **PHI Audit Logging:** Every read, create, update, or void action involving PHI is logged centrally to the `audit_logs` table with context.
4.  **Immutable Medical Records:** Prescriptions and medical records cannot be hard-deleted. They are soft-deleted with a reason for auditability.
5.  **CSRF Protection:** All mutating actions (POST, PUT, PATCH, DELETE) require a valid CSRF token, checked via a double-submit cookie pattern.

## Secret Management

Secrets that can decrypt PHI or forge sessions live in `./secrets/` as files (mode 0600, deploy-user-owned). They are mounted into the api container at `/run/secrets/*` and loaded into env vars by the entrypoint script in [docker-compose.prod.yml](docker-compose.prod.yml). **They are not in the compose `environment:` block** — keeping them out of `docker inspect` output is the whole point.

| Secret file | Used by | Generator |
|---|---|---|
| `./secrets/postgres_password` | Bootstrap superuser PG password — migrate container only | `openssl rand -base64 48` |
| `./secrets/app_db_password` | `medicore_app` role password — api + worker (F-01 fix, ADR-008) | `openssl rand -base64 48 \| tr -d '\n'` |
| `./secrets/session_secret` | HMAC key for device-fingerprint HMAC (Phase 2 device trust) — see [lib/device-fingerprint.ts](artifacts/api-server/src/lib/device-fingerprint.ts) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `./secrets/field_encryption_key` | AES-256-GCM for diagnosis/vitals/medications/allergies/emergencyContact, the `vitals` table, and `imaging_attachments` study files — see [lib/field-encryption.ts](artifacts/api-server/src/lib/field-encryption.ts) | same Node generator |
| `./secrets/metrics_token` | Bearer auth for `/metrics` | `openssl rand -hex 32` |
| `./secrets/jwt_private_key` | Ed25519 private key — signs all JWTs — see [lib/jwt-secret.ts](artifacts/api-server/src/lib/jwt-secret.ts) | Atomic pair generator — see [secrets/README.md](secrets/README.md) |
| `./secrets/jwt_public_key` | Ed25519 public key — advertised at `GET /.well-known/jwks.json` for verifiers | Same atomic pair generator (must match `jwt_private_key`) |

`REDIS_PASSWORD` is still env-passed because compose interpolates it into `REDIS_URL` at parse time. File-mounting it requires an entrypoint rewrite; tracked as a follow-up. Lower priority than the PHI-decryption-capable secrets above.

### Rotation procedure

Rotation cost summary:

| Secret | Rotation cost | Why |
|---|---|---|
| `postgres_password` | seconds | Coordinate DB password change with container restart |
| `session_secret` | gradual | HMAC-only now (device fingerprinting); existing sessions unaffected; Phase 2 fingerprint cookies re-bind on next login |
| `metrics_token` | seconds | Update Prometheus scrape config in lockstep |
| `jwt_private_key` / `jwt_public_key` | gradual, no downtime | Overlap window via `JWT_PREV_PUBLIC_KEY` lets old tokens verify while new tokens use new key |
| `field_encryption_key` | gradual, no downtime | Envelope `enc:v2:<kid>:...` (lib/field-encryption.ts) supports a second key during overlap |

Annual rotation, or immediate rotation on suspected compromise:

1. Generate the new value (commands above).
2. Write to a temporary file with the same mode: `chmod 600 ./secrets/<name>.new`.
3. **Postgres password**: rotate at the DB first (`ALTER USER … WITH PASSWORD`), then `mv` the file, then `docker compose -f docker-compose.prod.yml up -d api migrate`.
4. **session_secret**: `mv ./secrets/session_secret.new ./secrets/session_secret && docker compose -f docker-compose.prod.yml up -d api`. Device fingerprint cookies re-bind on next login. No JWT session loss (JWTs are now EdDSA — they don't use this secret).
5. **metrics_token**: `mv` then api restart. Update your Prometheus scrape config in lockstep — otherwise scraping fails until both sides match.
6. **jwt_private_key / jwt_public_key**: rotation is bounded (not stop-the-world) via the overlap window. See the next section.
7. **field_encryption_key**: rotation is now bounded (not stop-the-world), but it's still a multi-step operation. See the field-encryption section below.

### JWT key rotation

JWT signing now uses Ed25519 (`EdDSA` algorithm) with a key ID (`kid`) in the JWT header. The public key set is advertised at `GET /api/.well-known/jwks.json`. Rotation works without invalidating any active sessions — old tokens continue to verify during the overlap window.

**How the overlap works**

The api loads two key sets at startup:

- Current key: `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` → kid = `JWT_KID` (default `"1"`). New tokens are signed with this key.
- Previous key (optional): `JWT_PREV_PUBLIC_KEY` → kid = `JWT_PREV_KID`. Tokens signed by the old key still verify.

`/.well-known/jwks.json` advertises both public keys. Any verifier (including the api itself) accepts either.

**Rotation procedure (quarterly, or on compromise of `jwt_private_key`)**

1. **Generate a new matched key pair** — save as `jwt_private_key.new` + `jwt_public_key.new`:

   ```sh
   node -e "
   const c = require('crypto');
   const kp = c.generateKeyPairSync('ed25519', {
     privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
     publicKeyEncoding:  { type: 'spki',  format: 'pem' },
   });
   require('fs').writeFileSync('./secrets/jwt_private_key.new', kp.privateKey);
   require('fs').writeFileSync('./secrets/jwt_public_key.new',  kp.publicKey);
   "
   chmod 600 ./secrets/jwt_private_key.new ./secrets/jwt_public_key.new
   ```

2. **Decide the new kid string** — e.g., `"2"` (or a date string like `"2026-Q3"`).

3. **Add `JWT_PREV_PUBLIC_KEY` and `JWT_PREV_KID` to the entrypoint** in `docker-compose.prod.yml` api `command:`, reading from a mounted `jwt_prev_public_key` secret:

   ```sh
   # Add to the secrets loop:
   for s in ... jwt_prev_public_key; do ...
   # Add after existing exports:
   export JWT_PREV_PUBLIC_KEY="$$(cat /run/secrets/jwt_prev_public_key)"
   export JWT_PREV_KID="1"         # the kid of the OLD key
   export JWT_KID="2"              # the kid of the NEW key
   ```

   Mount the old `jwt_public_key` as `jwt_prev_public_key` by adding to compose `secrets:`:

   ```yaml
   jwt_prev_public_key:
     file: ./secrets/jwt_public_key        # still the OLD public key
   ```

4. **Swap the current key files**:

   ```sh
   cp ./secrets/jwt_public_key  ./secrets/jwt_prev_public_key
   mv ./secrets/jwt_private_key.new ./secrets/jwt_private_key
   mv ./secrets/jwt_public_key.new  ./secrets/jwt_public_key
   ```

5. **Redeploy**: `docker compose -f docker-compose.prod.yml up -d api`. Tokens signed with the old kid still verify (advertised as prev key in JWKS). New tokens use the new key.

6. **After the old key's max TTL has elapsed** (longest JWT TTL is super_admin at 15 min; wait at least 30 min to be safe): remove the `jwt_prev_public_key` secret, the `JWT_PREV_PUBLIC_KEY`/`JWT_PREV_KID` exports, and the `jwt_prev_public_key` compose stanza. Redeploy.

**Emergency rotation (key compromise)**

Same as above but skip the overlap window — replace the key immediately in step 4 and redeploy. Tokens signed with the compromised key will be rejected as soon as the api comes up (old kid no longer advertised in JWKS). Users are **not** logged out — their cookies hold the `clinic_token` JWT, but those tokens will fail verification and they'll receive a 401, prompting a re-login. This is the correct behavior on key compromise.

**Never** deploy a `jwt_private_key` that does not match `jwt_public_key` — the api pre-flight check validates both files are present and non-empty, but does not verify they form a pair. A mismatched pair causes all JWT verification to fail (cryptographic error on every request). Test the pair on the staging host before prod cutover.

### Field-encryption key rotation

The envelope format `enc:v2:<kid>:<iv>:<tag>:<data>` carries a key-id. Two keys can be registered at once — the new key starts decrypting writes immediately; the old key keeps decrypting historical rows until they are re-encrypted (lazily on next write of each row, or via a one-off sweep).

Step-by-step:

1. **Generate the new key**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > ./secrets/field_encryption_key_next`, `chmod 600 ./secrets/field_encryption_key_next`.
2. **Register the new key alongside the old** — edit `docker-compose.prod.yml`:
   - Append `field_encryption_key_next` to the api service's `secrets:` list.
   - Append the same name to the top-level `secrets:` declaration with `file: ./secrets/field_encryption_key_next`.
   - In the api service's `command:` shell script, add:
     `export FIELD_ENCRYPTION_KEY_NEXT="$$(cat /run/secrets/field_encryption_key_next)"`
3. **Redeploy**: `docker compose -f docker-compose.prod.yml up -d api`. The api now decrypts both kid=1 (old) and kid=2 (new) envelopes. New writes still use kid=1.
4. **Promote the new key for writes**: in the api service's `environment:` block, set `FIELD_ENCRYPTION_KEY_WRITE_KID: "2"`. Redeploy. New writes now produce `enc:v2:2:...`. Old rows continue to decrypt with kid=1.
5. **(Optional, eventual) Migrate old rows**: any service-layer write to an encrypted column produces a new envelope under kid=2. To force-migrate dormant rows, write a one-off script that reads + rewrites each affected row. **Field-encrypted text/JSONB columns** are: `patients.allergies`, `patients.emergencyContact`, `medical_records.diagnosis`, `medical_records.vitals`, `prescriptions.medications`, and `vitals.vitals` (the rapid-entry vitals table). **Imaging study files** (`imaging_attachments`) are a separate case — the encrypted `.enc` files on the imaging volume use the *same* key registry, with the kid stored per-row in `imaging_attachments.enc_kid`. Re-encrypting them means reading each file via `decryptBuffer` and rewriting it with `encryptBuffer` under the new write kid, then updating `enc_kid`/`enc_iv`/`enc_tag` — not a SQL column rewrite. **Rule: any new field-encrypted column or file added later MUST be appended to this list and to step 6's verification** (mirrors the "new PHI table ⇒ extend `executeErasure`" discipline).
6. **Retire the old key**: verify NO data remains under the old kid before removing it — check **every** encrypted store, not just the text columns:
   - **Text / JSONB columns** — for each of `patients.allergies`, `patients.emergencyContact`, `medical_records.diagnosis`, `medical_records.vitals`, `prescriptions.medications`, `vitals.vitals`: `SELECT count(*) ... WHERE col LIKE 'enc:v1:%' OR col LIKE 'enc:v2:1:%'` must be 0.
   - **Imaging files** — `SELECT count(*) FROM imaging_attachments WHERE enc_kid = '1' AND deleted_at IS NULL` must be 0 (and the matching on-disk `.enc` files re-encrypted under the new kid).

   Only when **every** count is 0: remove `field_encryption_key` from compose, rename `field_encryption_key_next` to `field_encryption_key`, and reset `FIELD_ENCRYPTION_KEY_WRITE_KID` back to `"1"`. You're now on a single fresh key with the kid namespace reset. **Removing the old key while any count is > 0 permanently destroys that PHI** — `decrypt`/`decryptBuffer` throw on an unregistered kid.

**Never delete or replace `field_encryption_key` without first migrating all rows** — any v1 or v2-kid-1 envelope becomes unreadable if its key is removed from the registry. The new module throws a clear error on read in that case, but the data is effectively lost.

Backward-compat invariant pinned by [field-encryption.test.ts](artifacts/api-server/src/tests/field-encryption.test.ts): pre-rotation `enc:v1:...` envelopes (written before the KID slot existed) decrypt with the kid="1" key. If you ever change which env var feeds kid="1", every PHI row encrypted under the old `FIELD_ENCRYPTION_KEY` becomes unreadable.

### Compromise response

Treat any of the following as a SEV-1 incident:

- A `./secrets/*` file's mtime is more recent than your deploy log expects.
- `docker inspect medicore-api` reveals any of `SESSION_SECRET`/`FIELD_ENCRYPTION_KEY`/`METRICS_TOKEN` in the `Env` array. (Should be empty for those three after the A10 migration.)
- A backup of `./secrets/` ends up anywhere outside the deploy host.

Recovery: rotate the affected secret immediately per the procedure above; for `session_secret`, force-logout everyone (acceptable — see step 4); for `field_encryption_key`, escalate to the engineering manager — it is the most dangerous secret in the system and an unplanned rotation is a multi-hour outage at best.

## Password Policy — HIBP Fail-Open Decision (F-08)

**Conscious architectural choice — signed off 2026-06-02.**

When `PHASE2_STRICT_PASSWORD_POLICY=true` is enabled, new passwords are checked against
the [HaveIBeenPwned k-anonymity API](https://haveibeenpwned.com/API/v3#PwnedPasswords).
If HIBP is unreachable (network timeout or 5xx), the strict password validator **fails
open** — the password is accepted without the breach check.

**Why this is intentional:**

- MediCore is an internal-staff system. A nurse or pharmacist who cannot log in during
  a HIBP outage cannot administer patient care. Availability takes precedence over the
  marginal security benefit of HIBP during outages.
- The primary mitigations are the other strict-mode requirements (12 chars + special
  char + dictionary blocklist) which are always enforced regardless of HIBP reachability.

**Observability (so it's not silent):**

The Phase 2 validator logs `audit_hibp_check_skipped` when it falls through. Implement
an alert or metric on this log line to know when HIBP is degraded. The current metric
`audit_log_write_failures_total` does NOT cover HIBP skips — a dedicated
`password_hibp_skip_total` counter should be added if HIBP availability becomes a
concern.

**If you want fail-closed behavior:** change `validatePasswordStrictAsync()` in
`lib/password.ts` to rethrow HIBP network errors instead of returning `{ ok: true }` on
catch. This will cause password changes to fail with a 503 during HIBP outages — test
this against acceptable UX degradation before enabling.

## Patient Consent — Enforcement Scope (F-P3-3 decision)

Active `treatment` consent (`hasActiveConsent`, `patient_consents` table) is enforced
**before clinical-record creation** — specifically `createMedicalRecord` and
`createPrescription` throw `ConsentRequiredError` (HTTP 422, code 3010) when no active
treatment consent exists. The consent lookup is clinic-scoped (`hasActiveConsent` takes
`clinicId` and filters on it — F-P3-2).

**Diagnostic *orders* (lab / x-ray / ultrasound) are intentionally NOT consent-gated**
(decided 2026-06-06, F-P3-3, accepted-risk). Rationale: ordering a diagnostic test is
part of the triage / work-up that *precedes* a treatment decision — it is not itself
"treatment," and gating it would block legitimate clinical flow (e.g. a nurse ordering
labs during intake before the doctor documents a treatment plan). The PHI produced by
those orders is still protected by RLS tenant isolation, doctor-scope, field encryption,
and full audit logging. Revisit this decision if a regulatory regime is selected that
treats diagnostic ordering as a consented act.

## CVE Response Policy

Dependency vulnerabilities are surfaced by:
- The `audit` job on every CI run — blocks PRs on HIGH/CRITICAL findings at install time.
- The weekly `audit-weekly.yml` job — re-audits the locked tree and opens a `security`-labeled issue on new HIGH/CRITICAL findings disclosed since the last install.

Resolution SLA:

| Severity | Time to resolve | Notes |
|---|---|---|
| CRITICAL | 7 days | Patch, pin, or pre-merge-block; document in `.pnpmauditignore` only if no fix is available and impact is mitigated. |
| HIGH | 7 days | Same as above. |
| MEDIUM | 30 days | Patch or document; review at next planning interval. |
| LOW | Tracked, not blocking | Address opportunistically. |

If a vulnerability has no upstream fix, add an entry to `.pnpmauditignore` with the CVE/advisory ID, the dependency path, a one-line justification (why it's not exploitable in our usage), and a review date (+90 days).

## Metrics Endpoint Protection

`GET /metrics` (Prometheus scrape endpoint) is gated by a bearer token in production. Set `METRICS_TOKEN` in the server environment; the endpoint returns 401 if the `Authorization: Bearer <token>` header doesn't match. In development (`METRICS_TOKEN` unset) the endpoint is open. See `.env.example` for the generation command. Never expose Grafana via Caddy — SSH-tunnel only (`127.0.0.1:3000`).

## Secrets Scanning

`gitleaks` runs on every PR via `.github/workflows/ci.yml`. Findings block the build. If a secret was committed historically, rotate it — removing it from git history without rotation is not sufficient.

**Local pre-commit gap:** CI scans on push but there is no local pre-commit hook yet. Add one to catch secrets before they leave the machine:
```bash
# requires gitleaks installed (https://github.com/gitleaks/gitleaks)
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
gitleaks protect --staged --redact --no-banner
EOF
chmod +x .git/hooks/pre-commit
```

## Vulnerability Disclosure Policy

We take security seriously. If you believe you have found a security vulnerability in our application, please report it to us immediately.

### Reporting Guidelines

1.  Do not disclose the vulnerability publicly until we have had time to investigate and fix it.
2.  Do not attempt to access, modify, or delete data belonging to other users.
3.  Provide clear, reproducible steps for the vulnerability.

### Contact

Send all security reports to: `security@medicore.example.com`

### Scope

*   `@workspace/api-server`
*   `@workspace/clinic` (Frontend)
*   `@workspace/db` (Database Schema)

We will respond to all reports within 48 hours and work to deploy a fix as soon as possible.
