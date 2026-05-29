# Changelog

## Codegen post-step fix — `write-zod-index.mjs` (2026-05-29)

The `lib/api-spec` codegen script used an inline `node -e "..."` one-liner to write `lib/api-zod/src/index.ts` after every Orval run. Due to JSON + shell escaping layering, the shell command produced the literal characters `\n` (backslash + n) in the file instead of a real newline. TypeScript then reported `TS1127: Invalid character` and `TS2304: Cannot find name 'n'` on the first line, requiring a manual correction after every codegen run.

**Fix:** Replaced the inline command with a tiny standalone script [`lib/api-spec/write-zod-index.mjs`](../lib/api-spec/write-zod-index.mjs). The `codegen` entry in `lib/api-spec/package.json` now reads:
```
orval --config ./orval.config.ts && node write-zod-index.mjs && pnpm -w run typecheck:libs
```

No shell escaping required; the newline is a literal character in the `.mjs` source. Works identically on sh, cmd.exe, and PowerShell.

**449/449 tests passing.**

---

## P3-2 — Service worker for SPA shell (2026-05-29)

Adds an offline-resilient service worker to the SPA. No new npm dependency — hand-written SW in `public/sw.js` so build output and bundle size are unaffected.

**Caching strategies:**
| Request type | Strategy | Rationale |
|---|---|---|
| `/api/*` | Network-only | PHI must never enter CacheStorage |
| Navigation | Network-first + stale fallback | Users get latest HTML when online; SW serves shell offline |
| `script/style/font/image/manifest` | Cache-first | Vite output is content-hashed — cached entry is always correct for its URL |
| Mutations (POST/PATCH/DELETE/…) | Passthrough (not intercepted) | SW only intercepts GET |

**Files changed:**
- **`artifacts/clinic/public/sw.js`** — New service worker. Cache version `medicore-v1` (bump on strategy changes). Activate handler prunes stale caches. `self.skipWaiting()` on install for immediate activation.
- **`artifacts/clinic/src/main.tsx`** — Registers `/sw.js` on `window.load`. Registration is gated on `import.meta.env.PROD` — Vite dev server (HMR) is unaffected.
- **`nginx.conf`** — Exact-match `location = /sw.js` block with `Cache-Control: no-store` inserted before the generic `.js` regex rule. Without this, nginx would serve `sw.js` with `expires 1y, immutable` — preventing SW updates from ever deploying.

**449/449 tests passing** (no new tests — SW is a browser runtime artifact; unit testing requires a full browser environment).

---

## P3-1 — Deduplicate `cookie-signature` (2026-05-29)

`cookie-parser@1.4.7` declared an exact dep on `cookie-signature@1.0.6` while Express 5, `express-rate-limit`, and `supertest` all use `1.2.2`. Added `pnpm.overrides` to root `package.json`:

```json
"pnpm": {
  "overrides": { "cookie-signature": "^1.2.2" }
}
```

After `pnpm install`, `pnpm-lock.yaml` shows `cookie-parser@1.4.7` resolved to `cookie-signature: 1.2.2`. The `@1.0.6` resolution entry is gone from the lockfile. **449/449 tests passing.**

---

## P2-6 — Extract `medical_records.isGlobal` into `clinic_notices` (2026-05-29)

`isGlobal: boolean` and `globalReason: text` columns removed from `medical_records`. A dedicated `clinic_notices` table replaces the overloaded boolean flag. Closes the domain-model smell where a "clinic-wide advisory" was represented as a flag on a patient-specific PHI row.

| Item | Change |
|---|---|
| **`lib/db/src/schema/clinic_notices.ts`** | New table `clinic_notices`: `id`, `clinicId`, `title`, `content`, `createdBy`, `reason`, `deletedAt`, `createdAt`, `updatedAt`. Two indexes: `cn_clinic_idx`, `cn_created_idx`. |
| **`lib/db/src/schema/medical_records.ts`** | Removed `isGlobal` (boolean) and `globalReason` (text) columns. |
| **`lib/db/migrations/0011_clinic_notices.sql`** | Creates `clinic_notices` table; migrates any existing `is_global = true` records to notices (via `INSERT … SELECT`); drops `is_global` and `global_reason` columns from `medical_records`. |
| **`artifacts/api-server/src/lib/scope.ts`** | `assertMedicalRecordInScope`: removed Rule 1 (isGlobal bypass). Only rule remaining: `record.doctorId === req.user.userId`. Deny reason changed from `"record_not_owned_or_global"` to `"record_not_owned"`. `isGlobal` dropped from the SELECT projection. |
| **`artifacts/api-server/src/services/medical-records.service.ts`** | Removed `setGlobalFlag()` and its Zod schema. Removed `isGlobal` from `listMedicalRecords` SELECT. Removed unused `z` import. |
| **`artifacts/api-server/src/services/clinic-notices.service.ts`** | New — `listClinicNotices()` (cursor-paginated), `createClinicNotice()` (Zod validation: title 5–200, content 10+, reason 20+), `deleteClinicNotice()` (soft-delete + 404 guard). All functions log audit entries. |
| **`artifacts/api-server/src/routes/medical_records.ts`** | Removed `setGlobalFlag` import and `PATCH /medical-records/:id/global-flag` route. |
| **`artifacts/api-server/src/routes/clinic_notices.ts`** | New — `GET /clinic-notices` (all roles), `POST /clinic-notices` (super_admin), `DELETE /clinic-notices/:noticeId` (super_admin). |
| **`artifacts/api-server/src/routes/index.ts`** | Registered `clinicNoticesRouter`. |
| **`artifacts/api-server/src/tests/scope.test.ts`** | Updated: removed two `isGlobal` tests (Rule 1 tests), updated mock to exclude `isGlobal`, updated deny-reason expectation. |
| **`artifacts/api-server/src/tests/clinic-notices.service.test.ts`** | New — 9 tests: `listClinicNotices` (paginated/nextCursor/audit), `createClinicNotice` (creates+audit, 3 validation paths), `deleteClinicNotice` (soft-delete, 404). |

**Net test count: 449/449 passing** (was 442; +9 clinic-notices, −2 removed isGlobal scope tests).

---

## P2-2 — Remove `style-src 'unsafe-inline'` from CSP (2026-05-29)

`'unsafe-inline'` dropped from `style-src` in both the Helmet CSP header and the Vite production meta-tag string.

**Root cause analysis**: The comment `unsafe-inline retained: React style={} props + chart.tsx dangerouslySetInnerHTML` was misleading on both counts:
1. React `style={}` props use `element.style.*` (DOM API) — browsers do not apply `style-src` to JavaScript-set inline styles from already-trusted scripts; only static HTML `style` attributes and `<style>` elements are governed by `style-src`.
2. `ChartStyle` in `chart.tsx` was the one real `<style>` block injector — but `ChartContainer` is never imported or used in any production page (all pages import Recharts directly).

| Item | Change |
|---|---|
| **`artifacts/api-server/src/lib/csp.ts`** | `styleSrc` array: removed `'unsafe-inline'`; updated comment. |
| **`artifacts/clinic/vite.config.ts`** | `STRICT_CSP` string: removed `'unsafe-inline'` from `style-src`. |
| **`artifacts/clinic/src/components/ui/chart.tsx`** | `ChartStyle` (which returned a `<style dangerouslySetInnerHTML>` block) replaced with a no-op. `ChartContainer` now computes chart CSS custom properties as inline styles on the container `<div>` via a `useMemo`; `propStyle` merged correctly. Dark-mode `theme.dark` values are documented as unsupported via this approach (use `index.css` CSS vars instead). |
| **`artifacts/api-server/src/tests/csp.test.ts`** | New regression guard: `style-src does not allow 'unsafe-inline'` — prevents re-introduction. |

**Test count: 442/442 passing** (was 441; +1 new in `csp.test.ts`).

---

## Audit-log hash chain (2026-05-29)

Nightly SHA-256 hash chain over `audit_logs` rows. Detects silent row-level tampering. HIPAA §164.312(b) integrity verification.

| Item | Change |
|---|---|
| **`lib/db/src/schema/audit_integrity.ts`** | New — `auditIntegrityChecksTable`: `checkedDate` (DATE UNIQUE), `rowCount`, `rootHash`, `prevHash`, `status` (`ok`/`empty`/`mismatch`), `verifiedAt`, `createdAt`. |
| **`lib/db/migrations/0010_audit_integrity_chain.sql`** | New — `CREATE TABLE audit_integrity_checks` + unique index on `checked_date`. |
| **`artifacts/api-server/src/lib/audit-integrity.ts`** | New — `computeHashFromRows()` (pure SHA-256 over prevHash + rows ordered by id ASC), `recordDailyIntegrity(date?)` (idempotent upsert; defaults yesterday UTC), `verifyIntegrity(date)` (re-derives from stored prevHash; updates `status=mismatch` + fires counter on divergence). |
| **`artifacts/api-server/src/lib/metrics.ts`** | `auditIntegrityMismatchTotal` counter (`audit_integrity_check_failures_total`) added. |
| **`artifacts/api-server/src/cron.ts`** | New `"0 2 * * *"` (02:00 UTC daily) cron task — calls `recordDailyIntegrity(yesterday)`. |
| **`prometheus-alerts.yml`** | `AuditIntegrityMismatch` alert — `increase(audit_integrity_check_failures_total[1h]) > 0`, severity critical, no grace period. |
| **`artifacts/api-server/src/tests/audit-integrity.test.ts`** | New — 13 tests: `computeHashFromRows` (determinism, order-sensitivity, null fields, 64-char hex), `recordDailyIntegrity` (status ok/empty, genesis prevHash, omitted date, stable rootHash), `verifyIntegrity` (ok=true, mismatch + counter, missing record throws). |

**How the chain works:** at 02:00 each day, the cron hashes the previous day's rows as `SHA-256(prevHash || rows...)` where each row contributes `id:userId:clinicId:action:entityType:entityId:createdAt`. The `prevHash` is the stored `rootHash` from the prior record, or `"genesis"` for the first. Tampering with any row changes the hash; `verifyIntegrity()` will detect and record the mismatch.

**Querying for anomalies:**
```sql
SELECT checked_date, row_count, status, verified_at
FROM audit_integrity_checks
WHERE status = 'mismatch'
ORDER BY checked_date DESC;
```

**Test count: 441/441 passing** (was 428; +13 new in `audit-integrity.test.ts`).

---

## P2-4 — OpenTelemetry distributed tracing (2026-05-29)

OTel tracer wired into the API. HTTP server spans on every request; `withSpan()` helper for manual service-layer instrumentation. Zero overhead when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (noop API provider default).

| Item | Change |
|---|---|
| **`artifacts/api-server/src/lib/tracer.ts`** | New — `initTracer()` (SDK setup, OTLP exporter, `BatchSpanProcessor`), `getTracer()`, `withSpan<T>()` helper (OK/ERROR status, exception recording, context propagation), `httpSpanMiddleware` (HTTP server spans, path-only — no PHI in attributes). |
| **`artifacts/api-server/src/app.ts`** | `httpSpanMiddleware` mounted after `correlationId` so `req.id` is available as `app.request_id` span attribute; context propagates through all downstream middleware. |
| **`artifacts/api-server/src/index.ts`** | `initTracer()` called before `app` import (no-op without endpoint, zero impact on existing boot). |
| **`artifacts/api-server/build.mjs`** | `"@opentelemetry/*"` removed from `external` list — packages bundle into `dist/index.mjs` so the minimal runtime Docker image needs no extra `node_modules`. |
| **`artifacts/api-server/src/tests/tracer.test.ts`** | New — 9 tests: `initTracer` (noop + idempotent), `getTracer` (returns Tracer), `withSpan` (return value, error propagation, span passed to callback), `httpSpanMiddleware` (next() called, finish listener registered). |
| **`artifacts/api-server/src/tests/phase2.flagON.integration.test.ts`** | `mockActiveUser` extended with `isOnShift`, `phone`, `specialty`, `department` fields + `role: "doctor" as const` — TypeScript schema drift fix unrelated to OTel but surfaced by typecheck. |
| **`lib/db`** | Declarations rebuilt (`pnpm exec tsc -p lib/db/tsconfig.json`) to include `doctor_patients.d.ts` — necessary for typecheck after Flow 2 schema addition. |

**Configuration (production):**
```
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io   # or Tempo / Jaeger / Grafana Cloud
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<api-key>  # backend-specific auth header
```

**PHI rule**: span names and attributes MUST NOT contain patient data. Paths are safe (numeric IDs only); query params and request bodies are excluded from all span attributes.

**`withSpan()` usage pattern** (for service-layer instrumentation):
```typescript
const rows = await withSpan("patients.list", { "db.operation": "select" }, async (span) => {
  const result = await db.select()...;
  span.setAttribute("result.count", result.length);
  return result;
});
```

**Test count: 428/428 passing** (was 419; +9 new in `tracer.test.ts`).

---

## Flow 2 — Materialized `doctor_patients` scope table (2026-05-29)

O(N) `SELECT DISTINCT patientId FROM appointments WHERE doctorId = ?` replaced with O(1) indexed lookup on a dedicated 2-column scope table.

| Item | Change |
|---|---|
| **`lib/db/src/schema/doctor_patients.ts`** | New — `doctorPatientsTable` with composite PK `(doctorId, patientId)`, `clinicId`, `lastSeenAt`, and two indexes (`dp_doctor_idx`, `dp_clinic_idx`). |
| **`lib/db/src/schema/index.ts`** | Added `export * from "./doctor_patients"`. |
| **`lib/db/migrations/0009_smooth_hellfire_club.sql`** | New — `CREATE TABLE doctor_patients` + FK constraints + indexes + backfill `INSERT ... SELECT DISTINCT ON` from `appointments` with idempotent `ON CONFLICT DO UPDATE`. |
| **`artifacts/api-server/src/lib/scope.ts`** | `getDoctorPatientScope` now queries `doctorPatientsTable` (was `db.selectDistinct` on `appointmentsTable`). New export `recordDoctorPatientLink(clinicId, doctorId, patientId, lastSeenAt?)` — idempotent upsert using `onConflictDoUpdate`. |
| **`artifacts/api-server/src/services/appointments.service.ts`** | `createAppointment` + `patchAppointment` both call `recordDoctorPatientLink` after commit, before `invalidateDoctorScope`. `cancelAppointment` unchanged — historical relationships are preserved. |
| **`artifacts/api-server/src/tests/scope.test.ts`** | Mock updated: `appointmentsTable` → `doctorPatientsTable`, `selectDistinct` → `select`, `insert` added. 2 new `recordDoctorPatientLink` tests (correct args + default lastSeenAt). |

**Design decisions:**
- The table is append-only — `cancelAppointment` does NOT remove entries. A cancelled appointment is still a historical clinical relationship and should keep the doctor's PHI access scope intact.
- Redis cache (60s TTL, `doctor_scope:<doctorId>`) is now optional rather than required — the underlying DB lookup is O(1) indexed.
- `recordDoctorPatientLink` is idempotent: `ON CONFLICT (doctorId, patientId) DO UPDATE SET lastSeenAt = excluded.last_seen_at`.
- Backfill migration picks the most recent `scheduled_at` per `(doctor_id, patient_id)` pair as `lastSeenAt`, with `ON CONFLICT DO UPDATE` for idempotency on re-run.

**Test count: 419/419 passing** (was 417; +2 new in `scope.test.ts` for `recordDoctorPatientLink`).

---

## P2-3 — Additional Prometheus alerts + metrics endpoint test suite (2026-05-29)

7 new alert rules added to `prometheus-alerts.yml`; 9-test `metrics.test.ts` suite added.

| Item | Change |
|---|---|
| **`prometheus-alerts.yml`** | 7 new rules across 2 groups (see below). Total: 11 alert rules. |
| **`artifacts/api-server/src/tests/metrics.test.ts`** | New — 9 tests: 4 bearer-token protection tests + 5 custom-metric-name presence tests. |

**New alert rules:**

*Group `medicore-api-alerts` (4 new — no extra exporter required):*
- `AuditLogPermanentLoss` — CRITICAL, `for: 0m`: fires immediately when `increase(audit_log_write_failures_total[5m]) > 0`. PHI accessed without durable audit entry; HIPAA incident-class event.
- `AuditOutboxBacklog` — WARNING, `for: 10m`: `audit_outbox_depth > 100` sustained. Drain worker stuck or Postgres under pressure.
- `HighNodeMemory` — WARNING, `for: 5m`: `process_resident_memory_bytes > 805306368` (768 MB). Possible memory leak.
- `HighEventLoopLag` — WARNING, `for: 2m`: `nodejs_eventloop_lag_p99_seconds > 0.5`. CPU starvation or blocking sync I/O.

*Group `medicore-infrastructure-alerts` (3 new — require external exporters, documented inline):*
- `RedisHighMemory` — WARNING (`redis_memory_used_bytes / redis_maxmemory_bytes > 0.85`). Needs `redis_exporter`.
- `DiskSpaceCritical` — CRITICAL (`node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.10`). Needs `node_exporter`.
- `SSLCertificateExpiringSoon` — WARNING (`(probe_ssl_earliest_cert_expiry - time()) / 86400 < 14`). Needs `blackbox_exporter`.

**Infrastructure-alert rules are safe to commit** — Prometheus silently skips rules with no active series. They will have no matching metric until the relevant exporter is scraped; they won't generate false alerts. Alert routing and notification channels can be configured before the exporters are live.

**Test count: 417/417 passing** (was 408; +9 new in `metrics.test.ts`).

---

## Phase 2 flag-ON integration test suite (2026-05-28)

11-test `phase2.flagON.integration.test.ts` covering the 4 flag-ON behaviors listed in the roadmap. `debug-phase2.test.ts` (temp debugging file) deleted.

| Item | Change |
|---|---|
| **`artifacts/api-server/src/tests/phase2.flagON.integration.test.ts`** | New — 11 tests across 4 describe blocks (see below). |
| **`artifacts/api-server/src/tests/debug-phase2.test.ts`** | Deleted (temp debugging file from integration work). |

**Test groups:**
- `POST /auth/verify-device` (flag ON): token not found → 400 `{error:"invalid"}`; fingerprint mismatch → 400 `{error:"fingerprint_mismatch"}`; already-consumed token → 400 `{error:"expired_or_consumed"}` (atomicity); valid token + matching fingerprint → 200 with user + session cookie.
- `POST /auth/wasnt-me` (flag ON): expired/consumed token → 400; valid kill-switch click → 200 `{status:"revoked"}`.
- `POST /auth/login` role-branched (flag ON): privileged role on new device → 202 `{status:"pending_verification"}`, no `clinic_token` cookie; non-privileged role on new device → 200, `clinic_token` cookie set.
- `POST /auth/reset-password` strict policy (`PHASE2_DEVICE_TRUST_ENABLED=true` + `PHASE2_STRICT_PASSWORD_POLICY=true`): < 12 chars → 400 WEAK_PASSWORD; missing special char → 400 WEAK_PASSWORD; HIBP-known password (global `fetch` mocked) → 400 WEAK_PASSWORD.

**Key gotchas captured:**
- `isStrictPasswordPolicyEnabled()` is **gated by the master flag** (`isPhase2Enabled() && ...`). Setting only `PHASE2_STRICT_PASSWORD_POLICY=true` does nothing unless `PHASE2_DEVICE_TRUST_ENABLED=true` is also set.
- Zod's `resetSchema` enforces `newPassword: z.string().min(8)` — use 8+ char passwords in tests to avoid VALIDATION_ERROR instead of WEAK_PASSWORD.
- HIBP test stubs `globalThis.fetch` with `vi.stubGlobal` and computes the correct SHA-1 suffix from the test password to trigger the match.

**Test count: 408/408 passing** (was 397 before flag-OFF suite; +11 flag-ON; -1 debug deletion = net 408).

---

## Phase 2 OpenAPI sync + integration test suite (2026-05-28)

All 8 Phase 2 routes that were code-landed flag-OFF are now declared in the OpenAPI spec, codegen re-run, and covered by a new integration test suite (24 tests).

| Item | Change |
|---|---|
| **`lib/api-spec/openapi.yaml`** | Added 8 paths (`POST /auth/verify-device`, `POST /auth/wasnt-me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/admin-reset/{userId}`, `GET /account/devices`, `DELETE /account/devices/{deviceId}`, `POST /csp-report`). Added `PendingVerificationResponse`, `DeviceTokenBody`, `VerifyDeviceResponse`, `Device`, `DeviceListResponse`, `ForgotPasswordBody`, `ForgotPasswordResponse`, `ResetPasswordBody`, `AdminResetResponse` schemas. Renamed existing `ResetPasswordBody` (password-only, admin use) to `UserPasswordResetBody` to resolve duplicate key collision. |
| **`lib/api-zod/src/generated/api.ts`** | Regenerated by Orval. |
| **`lib/api-client-react/src/generated/api.ts`** | Regenerated by Orval. |
| **`artifacts/api-server/src/routes/csp-report.ts`** | Fixed path bug: route was registered at `/api/csp-report` but apiRouter is already mounted at `/api`, making effective URL `/api/api/csp-report`. Fixed to `/csp-report`. |
| **`artifacts/api-server/src/routes/index.ts`** | Phase 2 routers (`devicesRouter`, `passwordResetRouter`, `cspReportRouter`) moved to register BEFORE `usersRouter`. All other domain routers mount a global `router.use(requireAuth)` catch-all; Phase 2 anonymous routes (forgot-password, reset-password, verify-device, wasnt-me, csp-report) must appear before that catch-all to avoid being blocked with 403. |
| **`artifacts/api-server/src/tests/phase2.integration.test.ts`** | New — 24 tests across 8 describe blocks covering enumeration prevention, token validation, privilege gating, Phase 2 flag-off behavior, device management auth, UUID validation, and CSP report path. |

**Key test design notes:**
- `evaluate()` checks CSRF **before** token presence for `write`/`privileged` scopes on mutation methods. Tests that assert 401 (no token) must supply a CSRF double-submit pair first.
- Mock upgraded from non-thenable chainable proxy to thenable-resolves-to-`[]`, so `listDevicesForUser` returns an empty array and `rows.map(...)` returns `[]`.
- `POST /auth/verify-device` and `POST /auth/wasnt-me` return 503 immediately (`phase2_disabled`) before any DB interaction — no CSRF token needed.

**Test count:** 398/398 passing. Typecheck clean.

---

## P0-4 — clinic_id enforcement: service-layer multi-tenant isolation (2026-05-28)

Closes the "clinic_id is decorative" critical risk. The column existed on PHI tables since Phase 4 (default=1) but was never read by service queries or embedded in JWTs — cross-tenant reads were possible the moment a second clinic onboarded.

| Item | Change |
|---|---|
| **`lib/db/src/schema/users.ts`** | Added `clinic_id integer NOT NULL DEFAULT 1` — users now carry a clinic association that propagates into the JWT. |
| **`lib/db/src/schema/inventory.ts`** | Added `clinic_id integer NOT NULL DEFAULT 1` (column was absent; other PHI tables already had it). |
| **`lib/db/src/schema/operations.ts`** | Added `clinic_id integer NOT NULL DEFAULT 1` (same). |
| **`lib/db/migrations/0008_acoustic_cassandra_nova.sql`** | `ALTER TABLE users / operations / inventory ADD COLUMN clinic_id integer DEFAULT 1 NOT NULL` — three-statement migration, no downtime. |
| **`artifacts/api-server/src/lib/auth.ts`** | Added `clinicId?: number` to `TokenPayload` (optional — backward-compat with existing JWTs; kernel fills gap with `?? 1`). |
| **`artifacts/api-server/src/lib/policy.ts`** | Added `clinicId: number` to `AuthUser` (required). Kernel fills `clinicId: payload.clinicId ?? 1`. Public scope gets `clinicId: 0`. |
| **`artifacts/api-server/src/middlewares/auth-gate.ts`** | `AuthRequest.user` extended with `clinicId: number` (required). |
| **`artifacts/api-server/src/services/auth.service.ts`** | `loginUser()` includes `clinicId: user.clinicId` in the JWT payload. |
| **8 PHI service files** | `patients`, `appointments`, `medical-records`, `prescriptions`, `lab`, `xray`, `ultrasound`, `billing` — every SELECT / INSERT / UPDATE / DELETE now includes `eq(table.clinicId, req.user!.clinicId)` in its conditions array. |
| **`operations.service.ts`** | Clinic filter added to all 4 functions. |
| **`inventory.service.ts`** | `listInventory` signature gains `req: AuthRequest`; clinic filter added to all 4 functions. |
| **`routes/inventory.ts`** | `GET /inventory` handler updated to pass `req` to `listInventory(req, ...)`. |

**Backward compatibility:** `clinicId` is optional in `TokenPayload` — existing JWTs without the claim are accepted; the kernel fills `clinicId = 1`. Once sessions rotate (max 4h TTL), every active JWT carries the claim.

**Test count:** 379/379 (unchanged — existing test mocks use `as unknown as AuthRequest` / `as any` casts so the new required `clinicId` field causes no test failures). Typecheck clean.

**Migration:** Apply `pnpm --filter @workspace/db run db:migrate` (`0008_acoustic_cassandra_nova.sql`). All three `ALTER TABLE` statements use `DEFAULT 1 NOT NULL` — instant metadata-only change, zero downtime, existing rows get value `1`.

---

## P1-8 — SSE graceful drain on SIGTERM (2026-05-28)

Closes the "SSE drops on every deploy" risk. Previously SIGTERM caused `closeAllSSEClients()` to send `event: shutdown` and immediately terminate every SSE connection; all clients reconnected simultaneously (thundering herd). New SSE connections during shutdown received no special handling.

| Item | Change |
|---|---|
| **`lib/sse.ts`** | `closeAllSSEClients()` now sends `retry: <jitter>` + `event: reconnect\ndata: {reason, retryAfter}\n\n` per connection (jitter 5 000–15 000 ms, randomized per connection). Clients spread their reconnects rather than all hitting at once. |
| **`routes/notifications.ts`** | `GET /notifications/stream` checks `isShuttingDown()` and returns `503 + Retry-After: 10` immediately, refusing new SSE connections during drain. |
| **`index.ts`** | New `SSE_DRAIN_MS` constant (default 10 000 ms in prod, 0 in tests). Shutdown sequence holds existing SSE connections for `SSE_DRAIN_MS` before closing them, giving clients time to migrate to a new pod. `SHUTDOWN_TIMEOUT_MS` raised from 25 000 to 30 000 ms. Sequence comment renumbered. |
| **`docker-compose.prod.yml`** + **`docker-compose.yml`** | `stop_grace_period: 35s` added to api service — Docker's default 10s stop timeout was killing the process mid-drain before any graceful work could complete. |
| **`hooks/use-notifications-stream.ts`** | Added `reconnect` event listener — reads `data.retryAfter` and uses it as the reconnect delay. Existing `onerror` → fixed 5s reconnect remains as fallback for network errors. |
| **`tests/sse.test.ts`** (new) | 10 tests covering `closeAllSSEClients()` behavior (reconnect event shape, jitter range, per-connection variance, error tolerance, map clear) and the 503 drain guard on the SSE endpoint. |

**Test count:** 379 / 379 (was 369 — +10 new). Typecheck clean.

**Deploy note:** `SSE_DRAIN_MS` defaults to 10s; override via env var. `SHUTDOWN_TIMEOUT_MS` is now 30s — ensure the host process manager / orchestrator gives the process at least 35s before SIGKILL. Docker Compose `stop_grace_period: 35s` handles this.

---

## Build fix — mockup-sandbox vite.config.ts (2026-05-28)

`artifacts/mockup-sandbox/vite.config.ts` threw at config-load time when `PORT` or `BASE_PATH` env vars were absent. Both are only used by the `server` and `preview` configs — the `vite build` output doesn't depend on them. Changed both to optional with defaults (`PORT` → `"3000"`, `BASE_PATH` → `"/"`). Eliminates a pre-existing CI build failure that blocked `pnpm run build`.

---

## P1-9 — Erasure ↔ backup blackout coordination (2026-05-28)

Restoring from a pg_dump backup taken before a patient erasure's blackout window expires silently revives pre-erasure PHI. This change closes that gap: the erasure execution now records when the backup retention window clears, and both the restore drill script and RUNBOOK enforce re-anonymization.

| Item | Change |
|---|---|
| **`lib/db/src/schema/erasure_requests.ts`** | Added `erasureBlackoutUntil timestamp` (nullable) — set at execution time to `executedAt + BACKUP_RETENTION_DAYS`. |
| **`lib/db/migrations/0007_wide_zarda.sql`** | `ALTER TABLE "erasure_requests" ADD COLUMN "erasure_blackout_until" timestamp;` |
| **`artifacts/api-server/src/services/erasure.service.ts`** | `executeErasure()` now computes `erasureBlackoutUntil = now + BACKUP_RETENTION_DAYS` (from `process.env.BACKUP_RETENTION_DAYS`, default 7) and writes it inside the transaction when marking the request as `"executed"`. |
| **`scripts/backup-verify.mjs`** | New `checkErasureBlackouts()` step runs after `runRestoreTest()` in `--restore` mode. Queries the restored DB for rows where `status='executed' AND erasure_blackout_until > now()`. If any exist, logs each affected patient ID with their blackout window and **fails** the restore drill, preventing accidental promotion of a tainted restore. |
| **`RUNBOOK.md §2.2`** | New step 5 — "CRITICAL — Erasure re-application" — with the detection query, per-patient re-anonymization SQL block, and a note that `backup-verify.mjs --restore` runs the check automatically. Old steps 5–8 renumbered 6–9. |

**Test count:** 369 / 369 (unchanged — no new tests; existing erasure service tests continue to pass). Typecheck clean.

**Pre-migration note:** `pnpm --filter @workspace/db run db:migrate` to apply migration `0007_wide_zarda.sql`. Adds one nullable column to `erasure_requests` — instant metadata-only change, zero downtime.

---

## P1-1 — Audit transactional outbox (2026-05-28)

The audit write path changed from fire-and-forget (direct `INSERT INTO audit_logs`, lose on failure) to a transactional outbox pattern (write to an unindexed `audit_outbox` queue, drain to `audit_logs` with exponential backoff retry). Under a Postgres outage PHI reads still succeed and audit events are now **delayed**, not permanently lost.

| Item | Change |
|---|---|
| **`lib/db/src/schema/audit_outbox.ts`** (new) | `audit_outbox` table — same columns as `audit_logs` minus indexes, plus `attempts integer DEFAULT 0` and `next_attempt_at timestamp`. No FK references (intentional — allows writes to succeed even if user record changes before drain). |
| **`lib/db/migrations/0006_odd_machine_man.sql`** | `CREATE TABLE "audit_outbox" (…)` — no indexes, no FKs. |
| **`lib/db/src/schema/index.ts`** | Added `export * from "./audit_outbox"`. |
| **`artifacts/api-server/src/lib/audit.ts`** rewrite | `logAudit()` now inserts into `audit_outbox` (not `audit_logs`). On outbox-insert failure the counter + Pino log still fire (log key changed from `audit_write_failed` → `audit_outbox_write_failed`). New `drainAuditOutbox()` function: fetches up to 100 ready rows (attempts < 5, nextAttemptAt NULL or past), inserts each into `audit_logs`, deletes on success. Failure path: increment `attempts`, set `nextAttemptAt = now + backoff` (5 s, 30 s, 2 min, 10 min). Row exhausted after 5 attempts: increments `audit_log_write_failures_total` counter + logs `audit_outbox_row_exhausted`. |
| **`artifacts/api-server/src/lib/metrics.ts`** | Added `auditOutboxDepthGauge` Prometheus gauge (`audit_outbox_depth` — sampled at each drain tick). Updated `auditLogWriteFailuresTotal` help text to reflect permanent-loss semantics (exhausted rows, not temporary failures). |
| **`artifacts/api-server/src/cron.ts`** | Added `startAuditDrain()` / `stopAuditDrain()` — `setInterval` every 5 s, `.unref()`'d so it doesn't prevent process exit. Imports `drainAuditOutbox` from `./lib/audit`. |
| **`artifacts/api-server/src/index.ts`** | Imports `startAuditDrain`, `stopAuditDrain` (start alongside cron jobs; stop in graceful shutdown step 2b). Imports `drainAuditOutbox` for final flush (step 6b, before `pool.end()`). Shutdown sequence comment updated. |
| **Test file updates** | `audit.failure.test.ts` updated: mock changed from `auditLogsTable` → `auditOutboxTable`, log-message assertion updated to `"audit_outbox_write_failed"`. Five test files (`auth-flow.integration.test.ts`, `routes.envelope.integration.test.ts`, `route-access.contract.test.ts`, `trust-proxy.test.ts`, `audit.failure.test.ts`) all have `auditOutboxTable: {}` added to their `vi.mock("@workspace/db")` stubs. |

**Test count:** 369 / 369 (unchanged — existing tests updated, no new tests added). Typecheck clean.

**Pre-migration note:** `pnpm --filter @workspace/db run db:migrate` to apply migration `0006_odd_machine_man.sql`. The `audit_outbox` table will be created (no schema changes to existing tables).

---

## M8 — Drop `invoices.items` JSONB dual-write (2026-05-28)

The `invoices.items` JSONB column has been removed. `invoice_items` (normalized table, present since Phase 3) is now the single source of truth for invoice line-items.

| Item | Change |
|---|---|
| **`lib/db/src/schema/billing.ts`** | Removed `items: jsonb("items").notNull()` from `invoicesTable`. Removed `jsonb` from the import. |
| **`artifacts/api-server/src/services/billing.service.ts`** | Removed dual-write: `createInvoice()` no longer writes `parsedItems.data` to the `items` column. Added two private helpers: `fetchInvoiceItems(invoiceId)` (single invoice, for get/update/cancel/pay) and `fetchInvoiceItemsBatch(invoiceIds[])` (batch fetch keyed by invoiceId, for list). All six returning functions now include `items: InvoiceItem[]` sourced from the normalized table. API response shape is unchanged. |
| **`lib/db/migrations/0005_charming_psynapse.sql`** | `ALTER TABLE "invoices" DROP COLUMN "items";` — single statement, no cascade risk. |

**Pre-migration note**: Running this migration on a live DB is instant (metadata-only column drop in PostgreSQL 16). Apply with `pnpm --filter @workspace/db run db:migrate` before restarting the api.

**Test count:** 369 / 369 (unchanged — no new tests; existing billing/jsonb-schemas tests continue to pass). Typecheck clean.

---

## M3 — EdDSA + JWKS (2026-05-28)

JWT signing migrated from HS256 symmetric (`SESSION_SECRET`) to Ed25519 asymmetric with a JWKS public endpoint and key rotation overlap support.

| Item | Change |
|---|---|
| **`lib/jwt-secret.ts` rewrite** | Exports `signingKey` (Ed25519 `KeyObject`), `jwksDocument` (public-keys-only JWKS with no `d` component), `jwksVerify` (`createLocalJWKSet` factory for `jwtVerify`), `CURRENT_KID` (from `JWT_KID` env var, default `"1"`). `JWT_SECRET: Uint8Array` export preserved from `SESSION_SECRET` for backward compat with `device-fingerprint.ts` HMAC. Dev fallback: ephemeral `generateKeyPairSync("ed25519")` with a logged warning. Production fail-closed if `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` unset. Previous-key overlap: `JWT_PREV_PUBLIC_KEY` + `JWT_PREV_KID` allow old tokens to verify while new writes use the current key. |
| **`lib/auth.ts`** | Import updated to `signingKey`, `jwksVerify`, `CURRENT_KID`. `SignJWT` header changed from `{ alg: "HS256" }` to `{ alg: "EdDSA", kid: CURRENT_KID, typ: "JWT" }`. `.sign(signingKey)`. `jwtVerify` updated to `(token, jwksVerify, { algorithms: ["EdDSA"] })`. |
| **`lib/policy.ts`** | Import updated to `jwksVerify`. `parseToken` uses `jwtVerify(token, jwksVerify, { algorithms: ["EdDSA"], clockTolerance: 30 })`. |
| **`routes/jwks.ts` (new)** | `GET /.well-known/jwks.json` — returns `jwksDocument` with `Cache-Control: public, max-age=3600`. No auth required (public keys are safe by definition). |
| **`routes/index.ts`** | `jwksRouter` imported and mounted before `healthRouter`. |
| **`tests/jwt-secret.test.ts` (new)** | 9 tests via `vi.resetModules()` + dynamic import pattern. Covers: JWKS structure (OKP/Ed25519, no `d` component), sign + verify round-trip, unknown kid rejected, `JWT_SECRET` is `Uint8Array` from `SESSION_SECRET`, key rotation overlap invariant (`JWT_PREV_PUBLIC_KEY` allows old tokens to verify). |
| **`docker-compose.prod.yml`** | Entrypoint loop extended to include `jwt_private_key` + `jwt_public_key`. Two new `export` lines. Both added to api service `secrets:` list and top-level `secrets:` declaration. Pre-flight comment block updated with atomic key pair generator. |
| **`SECURITY.md`** | Secret table updated (`session_secret` now "HMAC for device fingerprinting", two new `jwt_*` rows). Rotation cost table updated (`session_secret` is now gradual; `jwt_private_key/public_key` is gradual via overlap). New §"JWT key rotation" with 6-step quarterly rotation procedure and emergency rotation path. |
| **`.env.example`** | `SESSION_SECRET` comment corrected (HMAC only, no longer JWT signing). New block: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KID`, `JWT_PREV_PUBLIC_KEY`, `JWT_PREV_KID` with dev atomic-pair generator command. |
| **`.env.prod.example`** | Secrets block updated to include `jwt_private_key` + `jwt_public_key`. `JWT_KID` + `JWT_PREV_KID` documented as non-secret control vars. |
| **`secrets/README.md`** | Two new rows (`jwt_private_key`, `jwt_public_key`) with atomicity note and pair generator script. |

**Breaking change**: All existing HS256 JWT sessions are invalidated on deploy. Users will see a 401 and be prompted to re-login. Expected and one-time.

**Test count:** 360 → **369** (9 new in `jwt-secret.test.ts`). All 22 test files pass. Typecheck clean across all 4 workspaces.

---

## Security Hardening Bundle (2026-05-27)

Six remediation items from the principal-architect review board's 30-day launch-readiness plan, executed sequentially.

| Item | Change |
|---|---|
| **P0-7 — Express trust proxy** | `app.set("trust proxy", "loopback, linklocal, uniquelocal")` added to `app.ts` before all middleware. Behind Caddy on the docker bridge network `req.ip` previously resolved to the Caddy container IP — rate-limit keys, login-shield buckets, and audit IP fields all collapsed to one identity. 5 regression tests in `trust-proxy.test.ts`. |
| **Audit logs compound index** | `audit_entity_time_idx` on `(entity_type, entity_id, created_at)` added to `audit_logs`. Missing compound index would degrade HIPAA compliance queries as 7-year retention fills. Migration `0004_sudden_spectrum.sql` generated via `drizzle-kit generate`. |
| **P0-1 — Cursor pagination fully wired (frontend)** | OpenAPI spec updated: `offset` param → `cursor` (opaque string) on `/patients` and `/appointments`. New `PaginatedAppointments` schema aligns spec to the actual backend response shape `{ data, nextCursor }`. All 12 call sites in `pages/**` and `components/CommandPalette.tsx` migrated. `Appointments.tsx` and `DoctorDashboard.tsx` unwrapped `.data` — fixed a latent runtime bug where `.map()` was called on a `{ data, nextCursor }` object. CI grep guard added to `ci.yml` to block `offset:N` in clinic pages (`AuditLog.tsx` intentionally excluded). |
| **P0-3 — Secrets out of `environment:`** | `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `METRICS_TOKEN` removed from the api service `environment:` block in `docker-compose.prod.yml` and file-mounted via Docker secrets (`/run/secrets/*`). Entrypoint uses `set -eu` + `test -s` to fail-close before `exec node` if any secret file is missing. Dead `JWT_SECRET` env var also removed. `REDIS_PASSWORD` still env-passed (compose interpolates it into `REDIS_URL` at parse time — tracked separately). `.env.prod.example`, `.env.example`, `secrets/README.md`, and `SECURITY.md` updated. **Deploy action required before next prod restart**: create `./secrets/session_secret`, `./secrets/field_encryption_key`, `./secrets/metrics_token` (mode 0600). |
| **P1-5 — Route-access contract test** | New `route-access.contract.test.ts` (67 tests). Reads `lib/route-access.ts` navItems at test time; for each page × allowed role makes a supertest GET to the page's primary backend endpoint and asserts status ≠ 403. Found and fixed active production bug: `pharmacist` was missing from `GET /prescriptions` and `GET /prescriptions/:id` — pharmacists were redirected to `/prescriptions` on login and immediately got 403. Fixed in `routes/prescriptions.ts`. |
| **P1-4 — CI security tooling** | Three new GitHub Actions workflows: `codeql.yml` (CodeQL SAST, javascript-typescript, `security-and-quality` queries), `security-scan.yml` (Trivy fs scan, `vuln,config`, HIGH/CRITICAL, `ignore-unfixed: true`, SARIF → Security tab), `sbom.yml` (Anchore Syft CycloneDX-JSON, archived per push/release). |
| **M2 — KID in field-encryption envelope** | `lib/field-encryption.ts` rewritten. New write path: `enc:v2:<kid>:<iv>:<tag>:<data>`. Legacy `enc:v1:` envelopes still decrypt via `kid="1"`. Key registry (`Map<kid, Buffer>`) populated from `FIELD_ENCRYPTION_KEY` (kid=1) + optional `FIELD_ENCRYPTION_KEY_NEXT` (kid=2). `FIELD_ENCRYPTION_KEY_WRITE_KID` controls which kid new writes use (default `"1"`; set to `"2"` to promote during rotation). Production fail-closed if write kid has no registered key. Field-encryption test suite rewritten: 19 tests. `SECURITY.md` updated with six-step key rotation procedure. |

**Test count progression:** 278 (baseline) → 286 (trust proxy +5) → 286 (pagination, no new tests) → 353 (route-access contract +67) → 360 (field-encryption +7)

---

## Bayan Design Port — Phases 4 + 5 (2026-05-27)

Completed the page rewrite and a11y phases. After this entry the visual port is feature-complete; only font self-hosting remains as a deferred optimization (Google Fonts CDN is the current source).

| Phase | Change |
|---|---|
| **Phase 4 — Page rewrites** | All 28 existing pages reskinned to Bayan classes (`.page`, `.card`, `.card-pad`, `.btn`, `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.badge`, `.badge-teal/sage/sand/rose/blue`). Zero remaining old-theme tokens (`text-muted-foreground`, `bg-card`, `bg-primary`, etc.) in `src/pages/**`. |
| **Phase 4 — Net-new pages** | Added 5 pages: `DoctorConsult.tsx` (tabbed EHR — Summary/History/Orders/Notes/Rx with deep-link `?p=<id>` via `useUrlSync`, dirty-state guard on tab change), `DoctorOrders.tsx` (consolidated lab/xray/ultrasound DataTable filtered by `requestedById`), `DoctorInbox.tsx` (doctor-scoped notifications), `NurseVitals.tsx` (rapid-entry form with `VitalChip` live preview + pain slider), `FrontDeskCheckin.tsx` (today queue with check-in button). |
| **Phase 4 — Routes** | Added 6 routes to `App.tsx`: `/today`, `/consult`, `/orders`, `/inbox`, `/checkin`, `/vitals`. Extended `lib/route-access.ts` with new `navItems` and `navPinnedByRole`: doctor pinned to `[today, schedule, patients, consult, orders, inbox]`; front_desk pinned to `[checkin, appointments, patients, billing]`; nurse adds `vitals`. `getLandingRoute` now sends doctor → `/today`, front_desk → `/checkin`. |
| **Phase 4 — Per-route ErrorBoundary** | New `RouteErrorReset` wrapper in `App.tsx` keyed by `useLocation()` so an error on one page is cleared when the user navigates away. |
| **Phase 4 — Quick fixes** | `.btn-outline` CSS class defined in `index.css` (was referenced but undefined). Triage.tsx hardcoded English toast strings replaced with `t("failed")`. |
| **Phase 5 — A11y sweep** | Global `:focus-visible` outline rule added in `index.css` (2px solid teal-500, 2px offset) — covers `a`, `button`, `input`, `select`, `textarea`, `[role=button|tab|menuitem]`, `[tabindex]`. ARIA on all new pages: `role="status"` on loading + empty states, `aria-label` on icon-only buttons. Layout sidebar already had `aria-current="page"` on active nav and `aria-label` on topbar icon buttons. |
| **Phase 5 — i18n** | ~60 new keys added to `hooks/i18n.tsx` for doctor pages, nurse vitals, front-desk checkin, doctor orders — full EN + AR coverage. Duplicates removed. |

**Deferred:** Self-hosted fonts. Google Fonts CDN is in use with `display=swap`. Migration to `public/fonts/*.woff2` + `@font-face` requires downloading binary assets and is tracked as a follow-up optimization for offline clinic networks.

**Verification:** `pnpm --filter @workspace/clinic run typecheck` passes clean.

---

## Bayan Design Port — Phases 0-3 (2026-05-26)

Full frontend visual overhaul porting the Bayan Clinic OS design system into MediCore. All data bindings are unchanged (real API hooks); only the UI layer was modified.

| Phase | Change |
|---|---|
| **Phase 0 — Token foundation** | Rewrote `index.css` with Bayan mint/sage editorial token system. `@theme inline` maps all vars to Tailwind semantic tokens. Supports `[data-palette]`, `[data-voice]`, `[data-density]`, `[dir="rtl"]` and full dark mode. Google Fonts imports for Newsreader, Geist, Geist Mono, Noto Naskh Arabic, Noto Kufi Arabic, Cormorant Garamond, IBM Plex. |
| **Phase 1 — Shared primitives** | `Metric`, `Sparkline`, `MiniBars`, `SearchPicker`, `VitalChip`, `PatientHeaderStrip`, `LiveActivityFeed` components added. `StatusBadge` extended with shape + tone tables (40+ statuses). `SkeletonRow`, `SkeletonMetric`, `SkeletonCard` skeleton variants added. Hooks: `usePendingId`, `useFirstMountLoading`, `useUrlSync`, `useCurrentPatientId`, `useTweaks`, `useSimpleToast`. |
| **Phase 2 — App shell** | `Layout.tsx` rewritten: 248px white sidebar + 64px topbar, Bayan `.nav-item` + `.is-active`, grouped sections for admin/super_admin, user pill + tweaks gear in footer, topbar with ⌘K pill + live clock + copy-link + notifications bell. `CommandPalette.tsx` created: ⌘K/Ctrl+K global overlay, nav + patient fuzzy search, keyboard nav. `TweaksPanel.tsx` created: Radix Popover with palette/voice/density chip groups. `Login.tsx` rewritten: split-screen art panel + quick-login dev chips. |
| **Phase 3 — RTL audit** | Replaced all directional Tailwind classes in pages/components with logical equivalents: `ml-*` → `ms-*`, `mr-*` → `me-*`, `pl-*` → `ps-*`, `pr-*` → `pe-*`, `text-left` → `text-start`, `text-right` → `text-end`, `border-l-*` → `border-s-*`. 15 new i18n keys added (EN + AR) for palette, command palette, login. |

---

## Phase 2 — Auth Hardening (flag-gated, default OFF) (2026-05-25)

All changes ship behind `PHASE2_DEVICE_TRUST_ENABLED` (default false). With the flag off, login behavior is byte-identical to pre-Phase-2. Run `pnpm --filter @workspace/db db:generate` to produce the migration before flipping the flag.

| Change | Details |
|---|---|
| Kill-switch helpers | `isPhase2Enabled()`, `isEmailVerifyEnabled()`, `isStepUpEnabled()`, `isStrictPasswordPolicyEnabled()`, `isCspReportEnabled()` in `lib/auth-constants.ts`. Master flag short-circuits every Phase 2 codepath. |
| `user_devices` table | (user_id, device_id) composite PK + fingerprint_hash + trusted/trust_source/trust_expires_at + revoked_at. Match logic: cookie → fingerprint → new. |
| `device_verification_tokens` table | Single-use, 15-min TTL, fingerprint-bound, atomic consume via `UPDATE … WHERE consumed_at IS NULL RETURNING`. Stores token_hash only. |
| `password_reset_tokens` table | Single-use, 30-min TTL, atomic consume. Sources: `self_service`, `admin_reset`. |
| `csp_reports` table | Ingests legacy `csp-report` + Reporting API shapes at `POST /api/csp-report`. |
| Device fingerprint | HMAC-SHA256 keyed by server secret, salted by user_id. UA-family + platform + client hints only. ASN/country deliberately excluded. |
| `__Host-device_id` cookie | 1-year TTL, HttpOnly, Secure, SameSite=Strict, host-only. Set on every successful login. |
| Device-trust dispatcher | `evaluateDeviceTrust()` returns `trusted` / `allow_unverified` / `blocked`. Blocks super_admin/admin/compliance_officer/doctor on new devices; non-privileged roles get `dvu=true` JWT claim instead. First-ever login auto-trusts (`trust_source: 'first_login'`). |
| Email service (Resend) | `services/email.service.ts` — Resend client + console-log fallback when `RESEND_API_KEY` is unset. Tags: `device_verify`, `device_alert`, `password_reset`, `compliance_alert`. |
| SMS service (Twilio stub) | `services/sms.service.ts` — provider-pluggable. Twilio wired; stubs to console when `SMS_PROVIDER` unset. |
| Routes | `POST /auth/verify-device`, `POST /auth/wasnt-me`, `GET/DELETE /account/devices/:id`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/admin-reset/:userId`, `POST /api/csp-report`. |
| Step-up middleware | `requireStepUp(action)` — re-verifies password via `X-Step-Up` header for destructive actions when `PHASE2_STEP_UP_ENABLED=true`. Audits `STEP_UP_OK` / `STEP_UP_FAILED`. |
| Device-scope middleware | `denyIfDeviceUnverified()` returns 403 `DEVICE_UNVERIFIED` when JWT carries `dvu=true`. Mount on bulk-PHI / export / settings routes during ramp. |
| Password policy hardening | Strict mode adds: 12-char minimum, special-char requirement, HIBP k-anonymity check, dictionary blocklist. Async `validatePasswordStrictAsync()` wraps it. |
| Self-service password reset | Anonymous endpoint with byte-identical response — no enumeration oracle. 30-min token TTL, atomic consume, revokes all sessions on success. |
| Admin reset | Returns short-lived raw token to compliance_officer/super_admin for out-of-band delivery. |
| Login response | New shape `{ user, deviceUnverified }` on success or `{ status: "pending_verification", message }` (HTTP 202) when blocked. |
| `useSessionTimeout` rewire | Now consumes `jwtExpUnix` so the warning lead matches per-role TTL instead of hardcoded 28/30 min. |
| Frontend pages | `ForgotPassword`, `VerifyDevice`, `AccountDevices` — wired in `App.tsx`. Public routes resolve before the unauthenticated `<Login />` fallback. |
| CSP report-uri | When `PHASE2_CSP_REPORT_ENABLED=true`, helmet emits `report-uri /api/csp-report` and reports are persisted. |
| Login route audit | New audit action `LOGIN_PENDING_VERIFICATION` for new-device blocks on privileged roles. |
| Test count | unchanged this PR — Phase 2 lands code under flag; tests + DB-migration verification follow in next PR before flipping the flag. |

**Follow-ups before flag-flip:** OpenAPI spec sync (new routes + `pending_verification` response + `dvu` claim) + codegen; `pnpm --filter @workspace/db db:generate` to produce the migration; Resend domain verification; CI runs the suite with the flag both on and off.

---

## Phase 6 (partial) — Cursor Pagination + Redis Doctor-Scope Cache (2026-05-25)

| Change | Details |
|---|---|
| Cursor pagination on all list endpoints | `patients`, `appointments`, `lab`, `xray`, `ultrasound`, `prescriptions`, `medical-records`. Query param `?cursor=<id>` replaces `?offset=<n>`. Hard max 100 rows per page. Response shape: `{ data, nextCursor }` (patients: `{ patients, total, nextCursor }`). |
| Ordering consistent | All paginable lists order by `id DESC` — monotonically correct for serial PKs, eliminates offset drift on inserts. |
| Redis doctor-scope cache | `getDoctorPatientScope(doctorId)` caches in `doctor_scope:<id>` with 60s TTL via `runtime.scopeCache` (optional). `invalidateDoctorScope` on appointment create/cancel. In-memory dev, Redis prod (no config change needed). |
| Phase 6 UUID/clinic_id reverted | Multi-tenancy additions (UUID PKs, `clinics` table, `clinic_id` FK, `clinicId` in auth) rolled back — single-tenant system remains integer PKs. Only pagination and scope cache are kept. |
| Phase 6 typecheck + parseInt fixes | All `No overload matches` errors from `req.query` string params passed to integer Drizzle columns — fixed with `parseInt()` guards across 9 service list/create functions. |
| **Test count** | 278 → **278** passing (unchanged — no DB integration tests for pagination) |

---

## Phase 5 — Compliance / HIPAA / GDPR (2026-05-25)

| Change | Details |
|---|---|
| `patient_consents` table | Consent types: treatment, data_sharing, research, marketing. `grantedAt`, `revokedAt`, `documentVersion`, `ipAddress`. Composite index on `(patientId, consentType)`. |
| Consent enforcement | `createMedicalRecord` + `createPrescription` check `hasActiveConsent(patientId, "treatment")` — throws `ConsentRequiredError` (HTTP 422) if no active consent. |
| Consent service + routes | `GET/POST /patients/:id/consents`, `DELETE /patients/:id/consents/:id` with per-role RBAC. |
| `lib/field-encryption.ts` | AES-256-GCM. Envelope: `enc:v1:<iv_hex>:<tag_hex>:<data_base64>`. `FIELD_ENCRYPTION_KEY` = 64 hex chars. Prod hard-fails without key; dev warns + runs unencrypted. Backward-compat on decrypt. |
| Field encryption wired | `diagnosis` + `vitals` on `medical_records`; `medications` on `prescriptions`; `allergies` + `emergencyContact` on `patients`. Encrypted at write, decrypted at read. JSONB columns store encrypted string literals. |
| Break-glass sessions | Any user can activate a 15-min emergency session. Immediate SSE alert to all `compliance_officer` users (`alertSentAt` recorded). Every PHI access during session logs `BREAK_GLASS_ACCESS`. |
| Break-glass service + routes | `POST /break-glass/patients/:id/activate`, `POST /break-glass/sessions/:id/revoke`, `GET /break-glass/sessions`. Owner or compliance_officer can revoke. |
| Right-to-erasure | Three-step: request → approve → execute. Execution anonymizes patient demographics + medical records (`[ERASED]`), soft-deletes prescriptions — all in a DB transaction. Irreversible (ADR-005). |
| Erasure service + routes | `GET/POST /erasure-requests`, `POST /erasure-requests/:id/review`, `POST /erasure-requests/:id/execute` (super_admin only). |
| Data retention cron | Monthly (1st @ 03:00). Reports audit logs >7yr + open erasure requests. SSE alerts compliance_officers if overdue. |
| Drizzle migration | `0001_free_moira_mactaggert.sql` — adds `patient_consents`, `break_glass_sessions`, `erasure_requests` tables + `consent_type` + `erasure_status` enums. |
| `ConsentRequiredError` + E.3010 | Error code 3010 in compliance range (3010–3019). HTTP 422. |
| **Test count** | 237 → **278** passing |

---

## Phase 0 + Phase 1 Remediation (2026-05-24)

| Change | Details |
|---|---|
| `credentials-backup.md` deleted | Contained plaintext staff passwords — removed from disk |
| `fix-db.ts` deleted | One-off MFA cleanup script had no business in the production source tree |
| `artifacts/clinic/src/lib/auth.tsx` deleted | Empty stub (`export {}`) — dead file |
| `scripts/post-merge.sh` deleted | Was running `pnpm --filter db push` on every merge — dangerous schema push shortcut |
| `temp_dashboard_ref/` deleted | Abandoned Next.js reference app with its own `package-lock.json` (violated pnpm-only guard) |
| `lib/jwt-secret.ts` created | Single source of truth for `JWT_SECRET`; both `auth.ts` and `policy.ts` now import from it |
| `auth-constants.ts` extended | `ROLE_TTL` (jose strings) + `COOKIE_TTL_MS` (ms) co-located — drift between JWT expiry and cookie maxAge is now structurally impossible |
| `/metrics` bearer-token gated | `METRICS_TOKEN` env var; open in dev, enforced in prod — operational intelligence no longer publicly readable |
| `@opentelemetry/api` removed | Was in prod dependencies with zero SDK/instrumentation wired — dead weight |
| `.nvmrc` + `engines.node >=24` added | Node version pinned at repo level, not just in CI |
| DB indexes added | `appointments`: `(doctorId, scheduledAt)` compound + partial unique (double-booking prevention) + `updatedAt`; `patients.phone`; `audit_logs.createdAt` |
| React `ErrorBoundary` added | Root-level error boundary — rendering crash in any page no longer kills the entire clinic app |
| Route-level code splitting | All 22 pages converted to `React.lazy()` + `Suspense` — separate chunk per route |
| **Test count** | 173 → **235** passing |

---

## Implemented Features (State as of 2026-05-18)

| Feature | Status | Key Files |
|---|---|---|
| HttpOnly cookie auth (C-01) | ✅ | `routes/auth.ts`, `lib/auth.ts`, per-role cookie TTL |
| Per-role JWT TTL + fingerprint | ✅ | `lib/auth.ts` ROLE_TTL, `fph` claim in `signToken` |
| v7 auth kernel | ✅ | `lib/policy.ts`, `middlewares/auth-gate.ts` |
| Login shield (WAF-equivalent) | ✅ | `middlewares/login-shield.ts` |
| Service layer extraction | ✅ | `services/` — 19 domain services |
| Canonical error envelope | ✅ | `errors.ts` E map, `middlewares/asyncHandler.ts` |
| CI guard (validate:errors) | ✅ | `scripts/validate-errors.ts`, `ci.yml` |
| Billing SoD | ✅ | `services/billing.service.ts` |
| Audit trail (PHI coverage) | ✅ | `lib/audit.ts`, `logRead`/`logAudit`/`logDenied` |
| Doctor scope (SQL-level) | ✅ | `lib/scope.ts` |
| RBAC (10 roles) | ✅ | `lib/db/src/schema/users.ts` |
| CSP (SPA + meta tag + regression guard) | ✅ | `lib/csp.ts`, `vite.config.ts`, `tests/csp.test.ts` |
| Prometheus + Grafana | ✅ | `lib/metrics.ts` |
| SSE (pluggable EventBus) | ✅ | `lib/sse.ts`, `lib/runtime/` |
| Session revocation (fail-closed) | ✅ | `RevocationStore`, `verifyToken` throw on store error |
| jti replay defense (privileged) | ✅ | `isJtiUsed`/`markJtiUsed` in `RevocationStore` |
| Compliance Dashboard | ✅ | `routes/dashboard.ts`, `pages/ComplianceDashboard.tsx` |
| Per-role dashboards (all 10 roles) | ✅ | 7 new endpoints in `dashboard.service.ts` + `routes/dashboard.ts`; 7 new pages; all in OpenAPI + codegen |
| Per-role navigation (Layer 2) | ✅ | `getLandingRoute()` + `navPinnedByRole` in `route-access.ts`; `RoleQuickActions` + `RoleContextLine` in `Layout.tsx` |
| Page chrome (Layer 3) | ✅ | `EmptyState.tsx`; `DataTable` density prop; status palette deduped + WCAG-differentiated; welcome-bar context line |
| Schedule system | ✅ | `routes/schedule.ts`, `services/schedule.service.ts` |
| Ultrasound module | ✅ | `routes/ultrasound.ts`, `pages/Ultrasound.tsx` |
| Dark mode toggle | ✅ | `Layout.tsx` — `.dark` on `<html>`, localStorage `theme` |
| Per-role UI improvements | ✅ | Triage kanban, Lab/XRay inline expand, nurse quick vitals |
| MFA (TOTP) | ❌ REMOVED | Completely removed — no files, no schema, no routes |
