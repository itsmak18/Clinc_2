# ADR-010: Revocation-Store Unavailability — Bounded Fail-Open for Reads

**Status:** Accepted  
**Date:** 2026-06-02  
**Supersedes:** —  
**Refines:** ADR-007 (jti Replay Defense — describes the prior unconditional read-scope degrade)  
**Related:** ADR-001 (Architecture Decisions), ADR-008 (app DB role)

---

## Context

`evaluate()` in `lib/policy.ts` consults `RevocationStore.getRevokedAt(userId)` on every authenticated request to enforce user-level session revocation (role-change session fixation defense, logout, security events). The store is Redis in production (`SESSION_STORE=redis`).

When that store **throws** (Redis outage, network partition), the kernel must decide whether to allow the request without a revocation check. The two pure strategies each carry a real cost:

| Strategy | Failure-mode cost |
|---|---|
| **Fail-open** (allow on store error) | A session revoked *before* the outage keeps reading PHI for the full token TTL (≤ 4 h). A fired employee or stolen cookie remains live for the whole outage window. |
| **Fail-closed** (deny on store error) | A brief Redis blip blocks **all** PHI reads clinic-wide. For an internal clinical tool this is a patient-safety cost — staff cannot see records during an outage. |

The prior behavior (described in ADR-007 §2) was **unconditional fail-open for `read` scope** — it logged a warning and continued for the entire outage. `write`/`privileged` already failed closed. This was flagged as **F-02 (read fail-open)** in the 2026-06-02 audit, which required either a fail-closed default or an owned decision recorded in an ADR. This is that decision.

---

## Decision

### Bounded fail-open for `read` scope, keyed on store-health recency

On a `getRevokedAt` error:

- `write` / `privileged` scope → **fail closed** (`AUTH_REVOKED`, code 1003). Unchanged.
- `read` scope → degrade (fail-open) **only if** the revocation store was last seen healthy within `REVOCATION_READ_GRACE_MS` (default **30 000 ms**). Past that window, **fail closed**.

```typescript
// lib/policy.ts — step 5b
const graceMs = Number(process.env.REVOCATION_READ_GRACE_MS ?? 30_000);
const withinGrace = graceMs > 0 && Date.now() - lastRevocationStoreOkAt <= graceMs;
if (scope === "read" && withinGrace) {
  // transient blip — store was healthy moments ago → degrade this read only
} else {
  // sustained outage (grace exceeded) or mutating scope → fail closed
}
```

`lastRevocationStoreOkAt` is per-process module state, updated on every successful `getRevokedAt`. It initializes to `0`, so a process that has **never** successfully reached the store fails closed from cold start (conservative).

### Rationale

- A **transient blip** (< 30 s) is the common, benign case — preserving read availability here avoids self-inflicted outages from momentary Redis hiccups.
- A **sustained outage** is the dangerous case: the longer the store is unreachable, the larger the window in which a revocation we can't see may have occurred. Past the grace window we revert to fail-closed, capping the revoked-session exposure to ≈ the grace duration rather than the full token TTL.
- This bounds the worst-case exposure from **≤ 4 h** (old behavior) to **≈ 30 s** while keeping availability resilient to blips.

### Operator lever

`REVOCATION_READ_GRACE_MS` is read per-request from the environment. During a *declared, prolonged* Redis incident where read availability must win over revocation freshness, an operator may raise the grace (or, with a documented risk acceptance, set it very high) — mirroring the `FINGERPRINT_BINDING=disabled` incident lever. Setting it to `0` forces immediate fail-closed (no tolerance). Default steady state is 30 s; do not change the default without revisiting this ADR.

---

## Consequences

- **Refines ADR-007 §2.** ADR-007 stated user-level revocation "degrades gracefully on read scope … and continues" unconditionally, contrasted with the jti check which never degrades. That read-degrade is now *bounded*. The jti check's behavior is unchanged (still always fail-closed). Engineers must not widen the read degrade back to unconditional without revisiting this ADR.
- **Sustained Redis outage now blocks reads after ~30 s.** This is intentional. Operators should treat a revocation-store outage as a P1 (it already degrades SSE/rate-limiting) and use the grace lever only as a conscious, logged risk acceptance.
- **Observability:** the degrade path logs `warn` with `detail: "degrade-within-grace"`; the fail-closed-on-outage path logs `error` with `detail: "store-unavailable:grace-exceeded"`. The decision `trace` carries the same detail for per-request forensics.

### Error codes

| Code | Name | HTTP | Condition |
|---|---|---|---|
| 1003 | `AUTH_TOKEN_REVOKED` | 401 | Store threw and request is `write`/`privileged`, or `read` past the grace window |
| — | (allow) | — | Store threw, `read` scope, within grace window (degraded) |
