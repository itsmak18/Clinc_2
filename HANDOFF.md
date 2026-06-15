# HANDOFF — MediCore (Clinic-Hub)

**Date:** 2026-06-15 · **Status:** in-flight list-contract fix **completed + verified this session**; 2026-06-14 principal-audit remediation still pending owner decisions. **Whole working tree is UNCOMMITTED** (see §3).

---

## 1. What this is
Continuation handoff. Two distinct, unrelated batches sit in the working tree:
1. **List-endpoint contract fix (2026-06-15, this session)** — a silent response-shape regression on the 5 clinical list endpoints, now fully resolved and verified (§2).
2. **2026-06-14 principal zero-trust audit** — findings + approved remediation plan, doc-only, no decisions executed yet (§4–§6). Full report: [docs/AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md](docs/AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md); task-level plan: `~/.claude/plans/system-prompt-you-frolicking-llama.md`.

## 2. Done this session — list-endpoint response contract restored ✅
**Symptom (regression):** the 5 doctor-bound clinical **list** services return `{ data, nextCursor }`, but their OpenAPI contracts declare a bare `type: array` and every frontend consumer treats them as arrays. The route GET handlers were sending the service object straight through, so each endpoint emitted `{ data, nextCursor }` instead of `[…]`.
- **Crash, not cosmetic:** [MedicalRecords.tsx:89](artifacts/clinic/src/pages/MedicalRecords.tsx#L89) `(records ?? []).filter(...)` and [Reports.tsx:205](artifacts/clinic/src/pages/Reports.tsx#L205) `labTests?.filter(...)` call `.filter` on the object → `TypeError` → page crash. `DoctorDashboard`/`PatientDetail` counts silently read `undefined`.
- **Fix:** all 5 route GET handlers now unwrap `res.json(result.data)`. The tree already carried 4 (lab/prescriptions/xray/ultrasound); this session added the straggler [medical_records.ts:21](artifacts/api-server/src/routes/medical_records.ts#L21). `nextCursor` is intentionally dropped — these lists are not cursor-paged on the client.
- **Not touched (correct as-is):** `/patients`, `/appointments`, `/clinic-notices` keep `{ data, nextCursor }` — their contracts are `Paginated*`. (8 services return the object shape; only those 3 map to `Paginated*`.)
- **Verified:** `pnpm --filter @workspace/api-server run typecheck` → exit 0; full `vitest run` → **484/484 green** (incl. `route-access.contract.test.ts` hitting GET /medical-records). No test asserted the broken shape.
- **Optional follow-up:** to add real client cursor pagination on these 5, promote the contracts to `Paginated*` → regen Orval → routes return `result` → pages read `.data`. Don't re-broaden piecemeal.

## 3. Working-tree state — NOTHING COMMITTED
`git status` (branch `main`):
```
 M artifacts/api-server/src/routes/lab.ts            ← list-fix (pre-existing WIP)
 M artifacts/api-server/src/routes/prescriptions.ts  ← list-fix (pre-existing WIP)
 M artifacts/api-server/src/routes/ultrasound.ts     ← list-fix (pre-existing WIP)
 M artifacts/api-server/src/routes/xray.ts           ← list-fix (pre-existing WIP)
 M artifacts/api-server/src/routes/medical_records.ts← list-fix (added this session)
 M docs/CHANGELOG.md   ← 2026-06-14 audit notes + 2026-06-15 list-fix entry
 M docs/HEALTH_STATUS.md / docs/ROADMAP.md / start-dev.ps1  ← from 2026-06-14 audit session
?? HANDOFF.md                                  ← this file
?? docs/AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md ← 2026-06-14 audit report
```
The 5 route edits form one coherent, test-green commit (the list-contract fix). The docs + audit report are the separate 2026-06-14 batch. Commit was **not** performed — left to the owner (suggest two commits: `fix(api): restore bare-array contract on 5 clinical list endpoints` and the audit-docs batch).

## 4. System state per 2026-06-14 audit (verified at source)
**8.4/10 — production-grade engineering, pre-production operations. No open Critical code defects.**
- Security architecture holds under line-by-line read — 20 claims VERIFIED first-hand: auth kernel ([policy.ts](artifacts/api-server/src/lib/policy.ts)), tenant RLS (dormant `0015` + `medicore_app` `0020` + break-glass read-only `0024`), AES-256-GCM PHI encryption prod fail-closed ([field-encryption.ts](artifacts/api-server/src/lib/field-encryption.ts)), append-only hash-chained audit **verified daily** in [cron.ts:127-142](artifacts/api-server/src/cron.ts#L127-L142), ESLint service/route + raw-`db` boundary.
- **CI:** 10-job blocking gate + real-Postgres integration suite (8 files / 62 tests). Unit/integration suite now **484** (count drifts — see F-Z3).
- **Not deployed.** Single Postgres (RPO ≈ 24h). Monitoring config structurally valid (`promtool`/`amtool` pass) but live delivery is deploy-gated.

## 5. Findings still needing a decision or action (from 2026-06-14)
**NET-NEW — security:**
- **F-Z1 (Medium) — jti replay defense is UNARMED.** [policy.ts:169](artifacts/api-server/src/lib/policy.ts#L169) checks `isJtiUsed()`, but **nothing in production calls `markJtiUsed()`** → protects zero live routes. **Decision (→ ADR-014):** arm it for the privileged single-use set (break-glass activate, step-up, admin-reset, erasure execute) **or** remove the latent check. *Recommend: arm.*

**DOC-TRUTH (Low — code is correct, docs trail):**
- **F-Z2** — `.claude/CLAUDE.md` "All tables use serial PKs" is false; PKs are mixed serial + `uuidV7()`.
- **F-Z3** — Scattered test counts (454/461/479/484) are stale; current non-DB suite = **484**. Replace prose counts with a CI badge.
- **F-Z4** — `pnpm-workspace.yaml` `minimumReleaseAgeExclude: []` is empty; CLAUDE.md's "except `@replit/*`" clause no longer applies.
- **F-Z5** — **REPLIT_DOMAINS removal is already code-complete.** [policy.ts:70-79](artifacts/api-server/src/lib/policy.ts#L70-L79) reads only `ALLOWED_ORIGINS`. ROADMAP/CLAUDE.md CORS lines are stale → doc-only cleanup.
- **F-Z6** — [tenant-context.ts:86](lib/db/src/tenant-context.ts#L86) comment ("via sql.raw") contradicts the safer parameterized `set_config` the code uses.

**RE-AFFIRMED risk register:** never deployed (H-1) · Postgres SPOF / RPO≈24h (H-2) · alert/probe **delivery** deploy-gated (H-3) · real-DB test breadth for business-logic services (H-4).

**Cross-check caution:** two sub-agent findings in the audit were false positives caught only by reading source (`.npmrc` "missing minimumReleaseAge" → it's in `pnpm-workspace.yaml:28`; "REPLIT still in policy.ts" → already gone). **Re-verify any agent claim against code.**

## 6. Approved remediation plan (condensed) + open owner decisions
> Ordered Correctness → Security → Performance → Maintainability. Full detail in the plan file.
- **Phase 0 — Go-Live (gating):** stand up staging + repo var `STAGING_URL`; activate alert/probe **delivery** (`amtool` test email + blackbox probe); restore drill on real hardware (record RTO); rehearse migrations + Phase-2 flag flips.
- **Phase 1 — Security:** resolve F-Z1 (ADR-014) + external pentest, then make `security-dast.yml` blocking.
- **Phase 2 — Test breadth (ADR-012):** real-Postgres `*.integration-db` tests for billing SoD, appointments FSM, prescriptions/consent, imaging, break-glass e2e.
- **Phase 3 — DR & scale (ADR-011):** WAL archiving + warm standby; validate 2nd API replica through PgBouncer; load/capacity test.
- **Phase 4 — Hygiene & doc-truth:** self-host fonts (drop `fonts.googleapis.com` from CSP); finish REPLIT doc cleanup (F-Z5); prune Expo/ngrok/mockup-sandbox; split `dashboard.service.ts`; doc-truth pass (F-Z2/Z3/Z4/Z6).
- **New ADRs:** 011 DB-HA/PITR · 012 integration-db coverage · 013 edge/DAST · 014 jti arm-vs-remove.

**Owner decisions (Mike):** (1) F-Z1 arm vs remove; (2) DR target (warm standby vs WAL-PITR vs managed HA); (3) mockup-sandbox keep-excluded vs delete; (4) authorize doc-truth edits to `.claude/CLAUDE.md` now or batch under Phase 4.

## 7. How to pick up / verify
- Local gate (every PR): `pnpm run typecheck` · `pnpm --filter @workspace/api-server run lint` · `validate:errors` · `test` · `test:integration-db` (real PG) · `pnpm --filter @workspace/clinic run test`. Keep `ci-gate` green.
- Read order: this file → [docs/AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md](docs/AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md) → plan file. Prior audits: [docs/AUDIT_REPORT.md](docs/AUDIT_REPORT.md), `docs/AUDIT_FINDINGS_2026-06-0*_PHASE*.md`.
- **Pending doc sync (CLAUDE.md Task Completion Rule):** Obsidian vault note for the 2026-06-15 list-fix not yet written.
