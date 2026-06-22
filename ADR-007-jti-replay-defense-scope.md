# ADR-007: jti Single-Use Replay Defense — Scope and Activation

**Status:** Accepted  
**Date:** 2026-05-31  
**Supersedes:** —  
**Related:** ADR-001 (Architecture Decisions), ADR-005 (Data Retention & Classification)

> ADRs 002–004 and 006 were not created as standalone records; those decisions were folded into ADR-001 at the time they were made.

---

## Context

JWTs in MediCore are **stateless session tokens**, reused across every API request for the duration of a session. Applying single-use jti enforcement to every request would invalidate the token after the first call, breaking ordinary multi-tab, multi-request sessions entirely.

At the same time, certain future operations — one-shot step-up confirmations, irreversible data-erasure execution, privileged administrative actions — need stronger replay protection than short TTLs and fingerprint binding alone can provide. A stolen token replayed within its TTL window would otherwise succeed.

The existing compensating controls for ordinary requests are:

| Control | Implementation |
|---|---|
| Short per-role TTLs | 15 min (super_admin) → 4 h (pharmacist, lab, xray, front_desk) |
| Fingerprint binding | `fph` claim checked on every request (`policy.ts`); mismatch → error 1004 |
| User-level revocation | `RevocationStore.getRevokedAt()` — invalidates all tokens minted before a timestamp |
| Double-submit CSRF | Origin + `X-CSRF-Token` vs `_csrf` cookie, method-gated in `evaluate()` |

These controls are sufficient for normal session requests. They are not sufficient for a one-shot privileged token that must be consumed exactly once.

---

## Decision

### 1. Scope jti single-use enforcement to the `privileged` request scope only

`evaluate()` in `lib/policy.ts:158–171` checks `isJtiUsed` only when `scope === "privileged"`. Ordinary `"read"` and `"write"` scope requests skip the check entirely.

```typescript
// lib/policy.ts:158–171
if (scope === "privileged" && payload.jti) {
  try {
    const used = await runtime.revocationStore.isJtiUsed(payload.jti);
    if (used) {
      step("jti", false, "replayed");
      return fail(E.AUTH_JTI_REPLAYED, "revoked");  // error code 1006, HTTP 401
    }
    step("jti", true);
  } catch {
    step("jti", false, "store-unavailable:closed");
    return fail(E.AUTH_REVOKED, "revoked");           // error code 1003, HTTP 401
  }
}
```

### 2. Fail-closed on store unavailability

If the `RevocationStore` throws during `isJtiUsed`, the kernel returns `AUTH_REVOKED` (code 1003) — the same error used for user-level revocation. The token is **denied**, not allowed. This is intentional: a momentary Redis outage cannot be used to replay a privileged token.

For contrast, `getRevokedAt` (the user-level revocation check at `policy.ts:173–188`) degrades gracefully on `"read"` scope — it logs a warning and continues. The jti check never degrades.

### 3. Pluggable store with TTL aligned to max token lifetime

`RevocationStore` is an interface with two implementations:

- **Memory** (`lib/runtime/memory/revocation-store.ts`) — dev/test, no persistence across restarts
- **Redis** (`lib/runtime/redis/revocation-store.ts`) — production; key `used_jti:<jti>`, TTL = `MAX_ROLE_TTL_SEC` (14 400 s, 4 h)

The TTL is aligned to the longest possible JWT lifetime (4 h for non-privileged roles; privileged one-shot tokens should be issued with a much shorter TTL, but 4 h is the safe upper bound). After expiry Redis auto-evicts the key; a replayed token past its `exp` is rejected by `jose` before the jti check runs anyway.

### 4. Current activation state: latent-but-ready

The kernel check and both store backends are **complete and tested**. No production route currently calls `runtime.revocationStore.markJtiUsed(jti)`. The defense is therefore wired and fail-closed but dormant — `isJtiUsed` will always return `false` until a route mints and consumes a one-shot privileged token.

This is intentional: the infrastructure is in place so that future one-shot flows do not need to redesign the policy kernel. The absence of `markJtiUsed` callers in production code is not an oversight — it is the correct state until a consuming flow exists.

> **Update 2026-06-22:** Three routes now request `privileged` scope — `PATCH /users/:id`, `DELETE /users/:id`, `POST /users/:id/reset-password` (and `password-reset` admin-reset). **All authenticate with the reused session cookie, NOT a one-shot token.** They are `privileged` to get the strongest *standing* posture (CSRF + fail-closed revocation + role + fingerprint + short TTL, plus dormant `requireStepUp`), **not** to get jti single-use. The session jti MUST NOT be consumed: doing so would reject the second privileged action in a session (e.g. editing two users) with `1006`. The kernel therefore only *reads* `isJtiUsed` and never marks. This safety invariant is pinned by `policy.unit.test.ts` → "evaluate() READS but never CONSUMES the jti". Genuine one-shot replay protection for admin actions belongs in a short-TTL step-up token, not the session cookie.

---

## Consequences

### Immediate

- Every `"privileged"` scope request pays one Redis round-trip for `isJtiUsed`. As of 2026-06-22 the privileged routes are `PATCH`/`DELETE /users/:id` and the two admin password-reset endpoints — all low-frequency admin actions, so the per-request `isJtiUsed` cost is negligible. The check is a no-op (`isJtiUsed` always `false`) until a one-shot flow calls `markJtiUsed`.
- The store unavailability behavior is asymmetric by design: jti fails closed; user-level revocation degrades on `"read"`. Future engineers must not "fix" this asymmetry without a deliberate security review.

### When a one-shot privileged token flow is introduced

Candidate flows: step-up confirmation tokens, data-erasure execution links, break-glass escalation tokens.

Any route that mints and consumes a privileged token **must**:

1. Issue the token with a short TTL (recommended: 5–15 min, not the role's session TTL).
2. After the operation succeeds, call `await runtime.revocationStore.markJtiUsed(jti)` to record consumption.
3. Reference this ADR in the route's implementation comment so the obligation is traceable.

Failure to call `markJtiUsed` leaves the defense as a no-op — `isJtiUsed` will always return `false` and replay will succeed.

### Error codes

| Code | Name | HTTP | Condition |
|---|---|---|---|
| 1006 | `AUTH_JTI_REPLAYED` | 401 | `isJtiUsed` returned `true` |
| 1003 | `AUTH_TOKEN_REVOKED` | 401 | Store threw during `isJtiUsed` (fail-closed) |
