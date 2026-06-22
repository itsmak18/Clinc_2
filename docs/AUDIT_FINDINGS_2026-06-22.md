# Security Review — 2026-06-22 (full-repository, HIPAA-grade)

**Reviewer:** Claude (security-review)
**Scope:** Full repository (selected by Mike). Auth kernel, PHI field encryption,
multi-tenant isolation (app-layer + Postgres RLS), doctor-scope + break-glass,
CSRF/cookies, all 31 route files + ~30 services, imaging file handling, frontend
print/XSS sinks, SSE, billing SoD, Docker/compose/secrets/CI.
**Method:** Read the code and traced trust boundaries; verified controls against
implementation rather than trusting docs.

**Outcome:** 1 HIGH, 1 Low–Medium, 3 Low. **All five remediated in this pass**
(service-layer enforcement + tests). Full api-server suite: **509/509 pass**,
`tsc --noEmit` clean.

---

## Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| F-1 | **HIGH** | `admin` → `super_admin` account takeover (no target-role guard; step-up dormant) | ✅ Fixed |
| F-2 | Low–Med | `/metrics` fails **open** when `METRICS_TOKEN` unset + non-constant-time compare | ✅ Fixed |
| F-3 | Low | Login username enumeration via response timing | ✅ Fixed |
| F-4 | Low (info) | SSE notification payloads carried clinical descriptors (not patient-identifying) | ✅ Fixed |
| F-5 | Low | Invoice `discount` unbounded → negative/inflated totals | ✅ Fixed |

---

### F-1 — HIGH — Vertical privilege escalation: `admin` → `super_admin`

**Locations:** `services/users.service.ts` (`resetPassword`, `updateUser`, `deleteUser`,
`toggleShift`); `routes/users.ts:63,85,97`; `middlewares/step-up.ts:29-32`; `scripts/src/seed.ts:90-91`.

**Exploit chain (default config, Phase 2 flag OFF):**
1. `POST /users/:userId/reset-password` is gated to `["super_admin","admin"]` + `requireStepUp` → an **`admin` reaches it**.
2. `requireStepUp` is a **no-op** when `PHASE2_STEP_UP_ENABLED` is off (the production default): `if (!isStepUpEnabled()) { next(); return; }`.
3. `resetPassword()` filtered only by `id`/`clinicId`/`deletedAt` — **no check on the target's role**.
4. `seed.ts:90-91` seeds `superadmin` and `admin` in the **same clinic**, so the `clinicId` filter doesn't protect the super_admin.

**Impact:** An authenticated admin resets the clinic super_admin's password and logs in as them — super_admin bypasses every role check in the kernel (`policy.ts:262`), reads all PHI, runs erasure, etc. `updateUser`/`deleteUser` similarly let an admin demote/deactivate/delete a super_admin. The system blocks admin→super_admin on *create/promote* (`ESCALATION_DENIED`) but left *acting on* an existing super_admin open. HIPAA §164.312(a)(1) access-control / SoD failure. Not CRITICAL only because it requires an authenticated admin insider.

**Fix:** Added a pure, exported guard `canManageTarget(actorRole, targetRole)` enforced in **all four** user-mutation service functions (each resolves the target's current role *before* mutating; emits `ESCALATION_DENIED` on deny). Rule: only `super_admin` may act on a `super_admin`; `admin` retains full management of all non-super_admin users (no functional loss). Service-layer placement means no route can bypass it.

**Regression test:** `tests/users.service.privesc.test.ts` — pure-policy cases + service-wiring assertions that the privileged write (`mockDb.update`) is **never called** on a blocked attempt (8 tests, green).

---

### F-2 — Low–Medium — `/metrics` fails open + non-constant-time compare

**Location:** `app.ts` (`/metrics` handler); `.env.example:54` (`METRICS_TOKEN=""` default).

When `METRICS_TOKEN` is unset, the endpoint served metrics with **no auth**; the bearer compare used `!==` (timing oracle). Exposure is limited (the `api` container publishes no ports — internal network only), so impact is operational-telemetry disclosure + a theoretical token-timing oracle, not direct PHI.

**Fix:** `/metrics` now **fails closed in production** when `METRICS_TOKEN` is unset (404 — also hides the endpoint; a failing Prometheus scrape surfaces it via `ServiceDown`), and uses `crypto.timingSafeEqual` for the bearer comparison. Dev behavior (serve without token) unchanged.

---

### F-3 — Low — Login username enumeration via timing

**Location:** `services/auth.service.ts` (`loginUser`).

The no-user/inactive path returned before any bcrypt verify, so responses were measurably faster than a valid-user/wrong-password attempt (bodies were already identical). Mitigated by login rate-limiting, but timing allowed enumeration.

**Fix:** The no-user branch now performs a real bcrypt verify against a cached dummy hash (`timingEqualizerHash()`) to equalize latency.

---

### F-4 — Low (informational) — Clinical descriptors on the SSE/Redis wire

**Location:** `services/{lab,xray,ultrasound}.service.ts` notification `message`.

The project rule is "SSE payloads must be IDs only." Notification messages carried clinical descriptors (test name, body part, exam type). **No patient identifier** was included and delivery is per-authenticated-user, so this was not a PHI leak — but the descriptors traversed Redis pub/sub. (The frontend `use-notifications-stream.ts` reads the payload to render a toast, so a naive IDs-only change would blank the toast.)

**Fix:** Genericized the `message` strings (the `title` field already conveys the category, e.g. "Lab Results Ready"), so no clinical descriptor rides the SSE/Redis channel while the toast stays useful.

---

### F-5 — Low — Invoice `discount` unbounded

**Location:** `lib/api-spec/openapi.yaml` (`CreateInvoiceBody.discount: number`, no `minimum`); `services/billing.service.ts` (`createInvoice`).

A negative discount inflated the total (overcharge); a discount > subtotal produced a negative total (usable to mask cash skimming in daily reconciliation).

**Fix:** `createInvoice` now rejects non-finite/negative discounts and discounts exceeding subtotal (service-layer business rule). Optional follow-up: add `minimum: 0` to the OpenAPI schema + regen (kept out of this pass to avoid codegen drift).

---

## Verified sound (re-checked, not assumed)

- **Tenant isolation** — every traced bare-`dbUnsafe` PHI query carries `eq(clinicId,…)`; PHI reads run in `runInTenantContext`; RLS dormant-by-default, `set_config(...,true)` parameterized (zero SQLi). Dashboard cache keys are `clinicId`-namespaced.
- **Auth/crypto** — EdDSA `algorithms:["EdDSA"]` pinned (no alg confusion), fail-closed tenancy/revocation, AES-256-GCM random 96-bit IVs, prod fail-closed key guard.
- **Doctor-scope + break-glass RLS** (0017 RESTRICTIVE, 0024 read-only bypass) — correct AND-semantics, GUC sanitized to ints, self-approval forbidden.
- **CSRF** (origin + `timingSafeEqual` double-submit), **cookies** (HttpOnly/Secure/SameSite=Strict), **print XSS** (`escapeHtml` + `safeUrl`, F-01 holds), **imaging** (magic-byte sniffing, server-generated keys, encryption at rest, no path traversal), **route auth coverage** (only `health`/`jwks`/`csp-report` public, by design), **infra** (non-root, `read_only`, `cap_drop ALL`, `no-new-privileges`, digest-pinned images, Grafana loopback-only, no published Postgres/api).
- **No** SQL injection, command injection (request paths), cross-tenant leak, or unauthenticated PHI route found.

---

## Verification

- New regression test: 8/8 pass.
- `pnpm --filter @workspace/api-server run typecheck` → exit 0.
- `pnpm --filter @workspace/api-server run test` → **509/509 pass (34 files)**.
- Integration-db suite (`*.integration-db.test.ts`) not run here (needs Docker/Postgres) — recommend running before merge to exercise the RLS-backed paths.
