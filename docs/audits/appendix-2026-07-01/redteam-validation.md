# Appendix H — Red Team Validation

**Audit date:** 2026-07-01 | **Branch:** security/search-doctor-scope

Two independent Red Team passes were run (the first stalled without producing output and was relaunched; both eventually returned results, so both are reconciled here). Where they disagreed, the disputed claim was checked empirically against the live repository rather than taken on either agent's word — see AUD-COMP-02 below, the one point where they gave opposite verdicts.

## Disposition Summary

| Disposition | Count |
|---|---|
| Upheld (legitimate issue) | 47 |
| Upheld (by design / policy decision, not a defect) | 5 |
| Upheld (partial — code correct, runtime proof outstanding) | 4 |
| Rejected (false positive) | 1 |
| Downgraded (real but overstated severity) | 2 |
| Resolved by design (no finding) | 2 |

## Rejected Findings

### AUD-FE-04 — REJECTED (confirmed false positive, both Red Team passes agree)
Frontend agent read only `build`'s `needs:` list and concluded `frontend-test` might not gate merges. `.github/workflows/ci.yml:294` defines the job; `ci.yml:338` lists it in `ci-gate`'s `needs:` array; `ci.yml:351` explicitly checks its result. Frontend tests **are** gated — via `ci-gate`, not `build`. No code fix needed.

## Corrected Finding — AUD-COMP-02 (Red Team passes disagreed; resolved by direct empirical test)

**Verdict: UPHELD — real, currently-unfixed PII leak into logs.**

The two Red Team passes gave opposite verdicts on one specific technical claim: does pino's redact path `*.email` match a **top-level** `email` key, or only a **nested** one (e.g. `user.email`)? This was settled by running pino directly against both shapes rather than trusting either agent's assertion of fast-redact's wildcard semantics:

```
redact.paths = ["*.email", "*.phone"]

{ email: "patient@example.com" }              → NOT redacted (logged in cleartext)
{ user: { email: "patient@example.com" } }    → redacted to "[REDACTED]"
```

`*.email` requires the key to sit one level under a wildcard parent — it does not match a bare top-level `email` key. `email.service.ts` and `sms.service.ts` log `{ email: msg.to }` / `{ phone: msg.to }` at the top level of the log object, so recipient PII is currently written to logs unredacted.

**This is not closed by the Pass-2 fix earlier in this session.** That fix correctly moved both services onto the shared `logger.child()` (fixing the "own unredacted pino instance" problem) and onto `config.*` (fixing the direct-`process.env` lint violation) — but it kept the same `{email: ..., phone: ...}` top-level key shape, which the existing redact paths never covered. The leak is narrower than originally reported (only affects the two services, not general Pino usage) but is real and currently live in the working tree.

**Fix (not applied — flagging per audit's own "report findings, don't fix" scope):** either add bare `"email"` / `"phone"` to `logger.ts`'s redact paths, or nest the recipient under an existing-covered key. Trivial, low-risk, one-line-per-path change.

## Other Corrected Severities

### AUD-COMP-01 — DOWNGRADE (Critical → Medium), both passes agree, second pass adds precision
`dashboard.service.ts` returns clinic-aggregate counts in most functions — correctly non-PHI. Exception: `getNurseDashboard()` (~line 303) and `getPharmacistDashboard()` (~line 370) return `patientId` in "recent items" lists (10-15 rows), unaudited. Real exposure, but role-gated and bounded in size — not a clinic-wide unaudited PHI export. Recommend adding `logAudit(req, "READ_LIST", ...)` to these two specific functions.

### AUD-API-02 — Kept at original severity (Medium), one Red Team pass's dismissal not accepted
The second Red Team pass called this a "non-issue" on the reasoning that "frontend date math is inherently local." That reasoning doesn't actually resolve the question the finding raised — whether `getWeekStart`'s use of browser-local `getDay()` can diverge from a clinic's configured IANA timezone (`CLINIC_TZ` / per-clinic tz already exists backend-side per CLAUDE.md) — and no agent traced `useDoctorSchedule.ts` to confirm dates are normalized before reaching this function. Original Medium severity + validation-required framing stands; this is an untracked WIP file, so no CI gate has seen it either way.

## Resolved-by-Design (No Finding)

### AUD-SEAM-02 — ADR-007 × ADR-010 intersection: RESOLVED, no window for the compound risk
Directly verified `policy.ts:179-219`. Precision correction from the second Red Team pass: the original framing ("no window exists") is correct for the *specific compound risk* under test (a revoked privileged token replayed via the inert jti mechanism during a revocation-store outage) — `privileged` scope fails closed on revocation-store error unconditionally, so it never touches the grace-window code path at all. This is a different claim from "no grace window exists anywhere" — the read-scope grace window is real and by design (see AUD-SEAM-06, documented separately, not a defect). Both things are true simultaneously; the original SEAM finding was scoped correctly, just worth stating precisely.

### AUD-SEAM-04 — SSE crash mid-drain: RESOLVED, design sound
`docker-compose.prod.yml stop_grace_period: 35s` exceeds the app's `SHUTDOWN_TIMEOUT_MS` (30s). No further action.

## ADR Re-Validation (Anti-Laundering Check)

| ADR | Code still matches? | Premise still holds? | Verdict |
|---|---|---|---|
| ADR-007 (jti privileged-only, latent) | Yes — `policy.ts:179-191` scoped to `privileged` only, fails closed on store error | Yes — no one-shot-token flow exists yet | **VALID** |
| ADR-008 (RLS dormant-by-default, medicore_app role) | Yes — `tenant-context.ts:91` sets `app.rls_enforce='on'` only inside the wrapper; zero route files bypass the service layer (AUD-API-03) | Yes — `medicore_app` NOSUPERUSER NOBYPASSRLS remains the documented production connection role | **VALID** |
| ADR-010 (revocation read bounded fail-open) | Yes — `policy.ts:193-219` implements exactly as documented, operator-tunable via `REVOCATION_READ_GRACE_MS` | Yes — no evidence outages now regularly exceed the assumed transient window | **VALID** |
| ADR-005 (audit retention manual-override, implied) | Yes — `cron.ts` reports only, never deletes; migration 0026 revokes DELETE at grant layer | Yes — manual/superuser-only deletion is a smaller tampering surface than automated deletion | **VALID** |

No guardrail has drifted from its documented design or gone stale.

## Coverage-Gap Meta-Findings

1. **Integration-DB suite did not execute this run** (Windows testcontainers Postgres startup failure, not a code defect) — every RLS/cross-tenant/append-only/CAS claim that depends on real-Postgres execution was verified by code inspection only, not by running the actual test suite. This is the single largest caveat over the entire audit and is carried into the main report's Runtime-Validation section rather than silently absorbed into a "PASS."
2. **Consent-gate coverage on vitals/lab/xray/ultrasound creation paths** (AUD-COMP-04) — neither Red Team pass traced this to a conclusive answer. Genuinely open; Needs-human-review.
3. **Erasure coverage drift risk** (AUD-COMP-05, `notifications`/`clinic_notices` tables) — not conclusively resolved either way.
4. **Performance/latency SLOs** — N+1 prevention verified in code; no query-plan or load-test review performed by any agent.
5. **Base-image CVE/SCA scanning** — Dockerfile hardening (non-root, read-only, cap-drop) reviewed; base-image freshness was not.
6. **i18n coverage for the new uncommitted schedule components** — parity test covers existing keys only; the 6 new schedule components' EN/AR completeness wasn't verified.

## Consensus-Strength Annotations

| Findings | Corroboration | Assessment |
|---|---|---|
| AUD-DEVOPS-01 + AUD-SEAM-03 (no down-migration) | Strong | Independent discovery from different angles (infra rollback vs. failure-mode blast radius), same root cause, same recommendation. Counted as one finding in scoring. |
| AUD-DB-05 + AUD-SEAM-05 (PgBouncer runtime proof) | Strong | Independent discovery, consistent framing ("code-correct, not runtime-proven"), same root cause (integration-db suite failure this session). Counted as one finding. |
| Tenant isolation mechanism (`SET LOCAL`+`nullif`) | Strong | Security agent (kernel angle) and Database agent (migration-SQL angle) reached the same conclusion via genuinely different evidence — real corroboration, not shared-prior restatement. |
| CI-gate wiring (AUD-DEVOPS-04 vs AUD-FE-04) | N/A — divergence, not consensus | The two agents disagreed; the disagreement itself is what surfaced the FE agent's incomplete read. Correctly resolved by direct file read, not by vote. |
| AUD-COMP-01 + AUD-API-08 | Weak / false corroboration | Both superficially touch "dashboard" but are unrelated issues (missing audit-log vs. stale fetch-pattern docs) that happen to share a component. |

## Final Note on Runtime-Validation Framing

**AUD-DB-05 / AUD-SEAM-05 (PgBouncer pooled-connection cross-tenant isolation) is reported as "consistent-with-fine on code inspection," never "proven fine."** All four prerequisite code-level properties (transaction wrapping, SET LOCAL usage, RLS fail-closed default, DISCARD ALL reset) are independently verified correct by two separate specialist agents reading different evidence. The missing piece is a dedicated runtime test exercising connection reuse across two tenants, which could not run this session (testcontainers Postgres failed to start on this Windows host — infra issue, not a code defect). This is the single most consequential open item in the audit and is treated accordingly under the severity-ceiling rule in the main report.
