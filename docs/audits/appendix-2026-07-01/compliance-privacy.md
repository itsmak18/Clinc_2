# Compliance & Privacy Appendix — HIPAA §164.312 / GDPR

Engineering Review Board · Compliance & Privacy specialist
Date: 2026-07-01 · Target: MediCore (ROOT = `Clinic-Hub/`)
Runtime constraint: **Docker unavailable → all `*.integration-db.test.ts` claims are NOT-EXECUTED** (validated by code-read only). Unit suite (538 api tests, DB mocked) reported GREEN by the board; not re-run here.

Evidence is from actual implementation. Deliberate ADR-backed behaviors are noted with residual risk, not raised as findings unless the code drifted from the ADR.

---

## 0. Scope method

Read + validated:
- `artifacts/api-server/src/lib/field-encryption.ts` (crypto core)
- `artifacts/api-server/src/lib/phi-fields.ts` (encrypted-column source of truth)
- Clinical write/read sites: `modules/clinical/{patients,medical-records,prescriptions,vitals}.service.ts`, `modules/search/search.service.ts`
- Schema: `lib/db/src/schema/{patients,medical_records,vitals,...}.ts`
- Audit: `lib/audit.ts`, `lib/break-glass-audit.ts`, `lib/logger.ts`
- Compliance: `modules/compliance/{erasure,break-glass,consent}.service.ts`
- Migrations: `0015` (RLS enable), `0017` (doctor_scope), `0024` (break-glass RLS bypass), `0026`/`0028` (audit append-only), `0035/0037/0038` (late-table RLS), `0029/0027` (clinic_id)
- ADR-005 (retention/classification), ADR-007 (jti), ADR-008 (app role), ADR-010 (revocation)
- `lib/config.ts`, `scripts/backup-verify.mjs`, `modules/audit/csp-report.service.ts`, `cron.ts`

---

## 1. PHI ENCRYPTION ADEQUACY AGAINST A THREAT MODEL (headline)

### 1.1 What IS field-encrypted (AES-256-GCM, `enc:v2:<kid>:<iv>:<tag>:<data>`)

Source of truth: `lib/phi-fields.ts::ENCRYPTED_PHI_FIELDS` (5 logical fields). Validated against actual `encrypt*()` call-sites:

| Column | Table | Write-site (encrypt) | Read-site (decrypt) |
|---|---|---|---|
| `diagnosis` | medical_records | `medical-records.service.ts:127,200` `encrypt()` | `:19` `decrypt()` |
| `vitals` (JSONB) | medical_records | `:130,167,203` `encryptJsonNullable()` | `:20` `decryptJsonNullable()` |
| `medications` (JSONB) | prescriptions | `prescriptions.service.ts:124` `encryptJson()` | `:21` `decryptJson()` |
| `allergies` | patients | `patients.service.ts:180,267` `encryptNullable()` | `:20` `decryptNullable()` |
| `emergencyContact` | patients | `patients.service.ts:181,268` `encryptNullable()` | `:21` `decryptNullable()` |

Additional (not in the memory "5" but genuinely encrypted at rest, same key registry):
- **`vitals.vitals` (standalone `vitals` table)** — `encryptJsonNullable`/`decryptJsonNullable`; the column name `vitals` is covered by the `phi-fields` redaction set by name. Confirmed schema comment `schema/vitals.ts:14-16`.
- **Imaging file bytes** (`imaging_attachments` X-ray/ultrasound uploads) — `encryptBuffer`/`decryptBuffer` (`field-encryption.ts:178-208`); on-disk file is pure ciphertext, kid/iv/tag stored on the row.

### 1.2 What is NOT field-encrypted (plaintext at rest in Postgres)

Direct-identifier / PHI columns stored as plain `text`/`date` (validated in `schema/patients.ts` and `schema/medical_records.ts`):

- `patients.fullName`, `fullNameAr` — patient name (direct identifier)
- `patients.dateOfBirth` (`date`) — DOB
- `patients.phone`
- `patients.idCardNumber` — **national ID** (`text`, `NOT NULL`, unique per clinic) — a strong identifier, plaintext
- `patients.mrn` — medical record number
- `patients.address`, `bloodType`
- `patients.insuranceProvider / insurancePolicyNum / insuranceMemberId / insuranceGroupNum / insuranceExpiry` — named HIPAA identifiers (§164.514(e)), plaintext
- `medical_records.chiefComplaint(+Ar)`, `treatment(+Ar)`, `notes`, **`diagnosisAr`** (the Arabic diagnosis is plaintext while English `diagnosis` is encrypted — asymmetric, see AUD-CMP-02)
- `prescriptions.notes / notesAr`
- `lab_tests.results/resultsAr/notes`, `xray_records.report/imageUrl/notes`, `ultrasound_records.*` — clinical result PHI, plaintext
- `appointments.reason/notes/cancellationReason` — free-text PHI, plaintext
- `vitals.notes`, `medical_records`/`prescriptions` Arabic clinical text

### 1.3 What protects the UNENCRYPTED PHI (control inventory)

| Control | Present? | Evidence | Protects against |
|---|---|---|---|
| **RLS tenant isolation** | Yes (dormant-gated) | `0015_enable_rls.sql`; late tables `services_catalog` 0035, `vitals` 0037, `imaging_attachments` 0038 | cross-tenant leak *inside* `runInTenantContext` |
| **`medicore_app` NOSUPERUSER NOBYPASSRLS** | Yes | ADR-008, migration 0020 | makes RLS actually enforce in prod |
| **doctor_scope RLS (5 clinical tables)** | Yes | 0017 + 0024 | doctor over-reach; vitals/imaging NOT in doctor_scope (app-layer only) |
| **GPG backup encryption** | Yes, prod fail-closed | `backup-verify.mjs:87` refuses unencrypted dump when `BACKUP_GPG_RECIPIENT` unset in prod | backup exfiltration |
| **Full-disk / volume encryption** | **UNKNOWN — requires validation** | no LUKS/dm-crypt config in repo; host-level, out of repo scope | raw disk/volume theft of the live PG data dir |
| **Log redaction** | Partial | `logger.ts` redacts name/phone/email/vitals/diagnosis/notes/reason/symptoms/address | PHI in logs (gaps: `idCardNumber`, `dateOfBirth`, `mrn`, `medications`, `allergies`, `emergencyContact` NOT in list — AUD-CMP-05) |
| **No PHI in cache** | Yes | only dashboard aggregates cached (`dashboard.service.ts`); `getPatientSummary`/billing daily uncached | decrypted PHI in Redis |
| **No PHI in SSE** | Yes (by rule) | IDs-only payloads | PHI over pub/sub |

### 1.4 Threat-model verdict (encryption adequacy)

**Field-level encryption here is a narrow, targeted control — adequate for the ONE threat it is scoped to (a stolen DB dump or compromised backup revealing the most sensitive free-text clinical fields: English diagnosis, structured vitals, medication lists, allergies, emergency contact) and NOT adequate as general at-rest PHI protection.** A stolen live-DB file or an un-GPG'd logical dump still exposes, in cleartext, every direct patient identifier — name, DOB, phone, **national ID**, MRN, address, full insurance identifiers — plus all Arabic clinical text, chief complaint, treatment, lab/imaging results, and appointment reasons. Backup exfiltration is well-covered (GPG fail-closed in prod). DB-at-rest theft of the *live volume* is covered ONLY if host full-disk encryption exists, which is unverified. A rogue/compromised `medicore_app` query is the weakest axis: RLS is **dormant outside `runInTenantContext`**, so any code path using bare `db`/`dbUnsafe` (which compliance/consent services legitimately do, and a compromised process could do freely) reads **all tenants, all rows, all plaintext PHI**, and can decrypt the 5 encrypted fields since the key is in-process (`field-encryption.ts:44-55`). Field encryption does not defend against attacker code execution in the app process. Net: correctly implemented crypto (GCM, 96-bit IV, kid rotation, prod fail-closed) solving a real but *bounded* problem; the residual exposure of unencrypted direct identifiers is the dominant PHI-at-rest risk and depends on full-disk encryption this repo cannot confirm.

**Falsification hypothesis (encryption adequacy):** *If* host volume encryption is confirmed AND all PHI reads route through `runInTenantContext` AND the process cannot be made to run attacker code, *then* the unencrypted columns are protected in-depth. Disconfirming test: `pg_dump` the live DB as `medicore_app` (or read the raw data dir) and grep for a known patient name / national ID — a cleartext hit disproves "PHI is encrypted at rest." Expected today: **HIT** (names/IDs are plaintext) → confirms encryption is field-scoped, not comprehensive.

---

## 2. FINDINGS

### AUD-CMP-01 · Audit-on-read is best-effort, not a precondition (read succeeds if audit write fails)
- **Category:** Audit trail / HIPAA §164.312(b) · **Severity:** Medium · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** `lib/audit.ts:86-96` — `logAudit` wraps the `audit_outbox` insert in try/catch; on failure only increments a metric + logs, never rethrows. Read paths call it AFTER the query and BEFORE returning but do not depend on success: `patients.service.ts:201` then `return`; `medical-records.service.ts:146-147`; list `:82-83`. Write is async-drained (5 s).
- **Supporting:** By design per transactional-outbox + CLAUDE.md ("Never block a read on audit-DB health"). ADR-005 covers retention, not fail-open-on-read.
- **Contradicting:** Break-glass reads use the durable `auditBreakGlass` path (AUD-CMP-04) that must resolve before PHI returns — highest-risk reads covered.
- **Assumptions:** Outbox insert failure is rare; a DB outage dropping the insert likely also fails the read query, narrowing the window.
- **Alternative explanations:** Intentional availability trade; undocumented for the *read* case specifically.
- **Files not reviewed:** non-clinical read paths calling `logRead`.
- **Validation required:** integration test — force outbox insert to throw, assert read still 200 + `audit_log_write_failures_total` increments. NOT-EXECUTED.
- **Risk if incorrect:** Low.
- **Falsification hypothesis:** *If* a PHI read is gated on audit, forcing the outbox insert to throw makes it 5xx. Disconfirming: 200 with PHI → confirms best-effort.
- **Improvement Engine:** *Problem* unaudited PHI read possible on silent outbox failure. *Root cause* `logAudit` swallows errors; reads don't check outcome. *Recommendation* mirror break-glass durability for single-record reads: on outbox throw, attempt synchronous `audit_logs` insert / local sink + `read_audit_unrecorded_total` critical alert; keep read fail-open for availability but make the loss observable + reconciled. *Benefits* no silently-unaudited reads. *Complexity* Low-Med · *Risk* Low · *Dependencies* reuse `break-glass-audit.ts`. *Migration* add `auditReadDurable()`, swap in ~8 read sites. *Rollback* revert to `logRead`. *Effort* ~0.5 d. *Priority* P2. *Metric* `read_audit_unrecorded_total==0` steady-state.

### AUD-CMP-02 · Asymmetric encryption: Arabic diagnosis plaintext while English is encrypted
- **Category:** PHI encryption completeness · **Severity:** Medium · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** `medical-records.service.ts:127-128` — `diagnosis: encrypt(...)` but `diagnosisAr: data.diagnosisAr` (no encrypt). `phi-fields.ts` lists only English `diagnosis`, so `diagnosisAr` is neither encrypted nor redacted in audit snapshots.
- **Supporting:** Bilingual columns added Phase 6 (`0019`) after the encryption design; call-sites not extended.
- **Contradicting:** English `treatment`/`chiefComplaint` are also plaintext, so `diagnosis` is the only encrypted/plaintext language split.
- **Assumptions:** Arabic diagnosis is PHI-equivalent to English (same datum).
- **Alternative explanations:** Deliberate single-canonical-field scoping — but no ADR/comment says so → drift.
- **Files not reviewed:** print templates rendering `diagnosisAr`.
- **Validation required:** confirm `diagnosisAr` populated in real data; grep dump. NOT-EXECUTED.
- **Risk if incorrect:** Low.
- **Falsification hypothesis:** *If* `diagnosisAr` is PHI-equivalent, a dump shows it cleartext beside an enveloped `diagnosis`. Disconfirming: also enveloped → no gap.
- **Improvement Engine:** *Problem* Arabic mirror of the one encrypted clinical field is cleartext. *Root cause* call-sites + `phi-fields.ts` not updated for bilingual columns. *Recommendation* add `diagnosisAr` to `ENCRYPTED_PHI_FIELDS`; wrap `encryptNullable`/`decryptNullable` at all sites; let the audit-snapshot drift guard enforce; classify `chiefComplaint*`/`treatment*` in ADR-005. *Complexity* Low · *Risk* Low (lazy re-encrypt; legacy plaintext passes through) · *Migration* extend list+sites+regen guard; optional backfill. *Rollback* revert. *Effort* ~0.5 d. *Priority* P2. *Metric* drift guard covers `diagnosisAr`.

### AUD-CMP-03 · Treatment-consent gate is service-layer only (no DB backstop) — bypassable
- **Category:** Consent (GDPR Art. 6/9) / HIPAA · **Severity:** Medium · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** Enforced only in app code: `medical-records.service.ts:113-115`, `prescriptions.service.ts:93-94` call `hasActiveConsent` then throw `ConsentRequiredError`. No DB constraint/trigger requires a live `patient_consents` row before clinical insert (searched migrations; none). `vitals.service.ts:20` documents intentional no-consent. Any new/forgotten insert path writes PHI with no consent.
- **Supporting:** Both current create paths check; `hasActiveConsent` (`consent.service.ts:24-39`) is clinic-scoped and correct.
- **Contradicting:** Only two clinical-record creation paths exist and both check — effective as wired today.
- **Assumptions:** Future features add clinical write paths.
- **Alternative explanations:** Team accepts service-layer enforcement (though tenant/scope were deemed to need a DB backstop → inconsistency).
- **Files not reviewed:** future/other write paths.
- **Validation required:** raw insert bypassing service → no DB rejection. NOT-EXECUTED.
- **Risk if incorrect:** Low.
- **Falsification hypothesis:** *If* consent is DB-enforced, an INSERT into `medical_records` for a consent-less patient is rejected by Postgres. Disconfirming: INSERT succeeds → service-only.
- **Improvement Engine:** *Problem* single missed check writes non-consented PHI. *Root cause* no DB invariant tying inserts to active consent. *Recommendation* `BEFORE INSERT` trigger on medical_records/prescriptions raising unless an active `treatment` consent row exists for `(clinic_id, patient_id)`; keep service check for the 422; exempt `vitals`. *Complexity* Med · *Risk* Med (seed/import) · *Migration* trigger migration, stage first. *Rollback* drop trigger. *Effort* ~1 d. *Priority* P2. *Metric* integration test: raw insert without consent rejected by DB.

### AUD-CMP-04 · Break-glass audit durability — VALIDATED STRONG (no finding; residual noted)
- **Category:** Break-glass / §164.312(a)(2)(ii) · **Severity:** Info · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** `break-glass.service.ts` — TTL 15 min post-approval / 5 min grace (`:16-17`); justification ≥30 chars + enum `reasonCategory` (`:117-125`); self-approval forbidden (`:278-280`); velocity alert (`:222-244`, threshold default 3); immediate SSE fan-out to same-clinic compliance officers (`:208-210`). Uses the **durable** `auditBreakGlass` (`break-glass-audit.ts`): synchronous direct `audit_logs` insert (not the async outbox) + local JSONL fallback sink + reconcile + metric (`:63-104`). Read-only RLS bypass via `app.break_glass_patient_ids` on the `doctor_scope` USING clause only (`0024`, WITH CHECK untouched).
- **Residual (accept):** (a) hybrid fail-**open** — if primary insert AND sink append both fail, returns without throwing; PHI proceeds (`break-glass-audit.ts:96-103`), by design; `break_glass_audit_failures_total` critical alert compensates. (b) fallback JSONL (`./storage/break-glass-audit/fallback.jsonl`) stores the row incl. free-text `justification` (possible PHI) as **plaintext on local disk** — depends on unverified host volume encryption. (c) `vitals`/`imaging_attachments` NOT in doctor_scope, so break-glass widening does not gate them at the DB layer (app-layer scope only). No ADR drift.
- **Validation required:** fault-inject both audit paths → access proceeds + critical metric. NOT-EXECUTED.

### AUD-CMP-05 · Log redaction list omits several PHI direct identifiers
- **Category:** PHI in logs / §164.312 · **Severity:** Low · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** `logger.ts:12-48` redacts name/phone/email/address*/city/region/postalCode/country/vitals/notes/reason/diagnosis/symptoms/password*. **Absent:** `idCardNumber`, `dateOfBirth`, `mrn`, `medications`, `allergies`, `emergencyContact`, `insurance*`. A raw-row log would print these cleartext.
- **Supporting:** No current `logger.*` in `modules/**` passes a raw PHI object (grep clean) — services log IDs/counts. Latent, not active.
- **Contradicting:** Redaction is belt-and-braces; call sites disciplined.
- **Assumptions:** Future code may log a raw row (the file comment records a real past top-level `{email}` leak).
- **Validation required:** add CI guard for `logger.*(row|patient|record)`. NOT-EXECUTED.
- **Risk if incorrect:** Low.
- **Improvement Engine:** *Problem* redaction incomplete vs PHI inventory. *Root cause* hand-curated, not schema-derived. *Recommendation* add the missing keys (+wildcards); derive the list from `phi-fields.ts`/a schema PHI tag; add a CI grep guard blocking bare-row logs. *Complexity* Low · *Risk* Low · *Effort* ~2 h · *Priority* P3 · *Metric* redact list ⊇ PHI inventory; guard green.

### AUD-CMP-06 · Right-to-erasure completeness — VALIDATED (all PHI tables); minor blackout mismatch
- **Category:** GDPR Art. 17 / erasure · **Severity:** Low · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** `erasure.service.ts::executeErasure` (super_admin only, `:110`) scrubs in one tx: `patients` demographics + all insurance identifiers + DOB→`1900-01-01` + encrypted allergies/emergencyContact (`:144-163`); `medical_records` diagnosis/vitals/Arabic (`:166-178`); `prescriptions.medications`→`[ERASED]`+soft-delete (`:182-190`); `lab_tests` (`:193-202`); `xray_records` incl. image URL/filename/jsonb (`:205-217`); `ultrasound_records` (`:220-232`); **`imaging_attachments`** metadata soft-delete + physical encrypted-file unlink after commit (`:238-243,283-289`); **`vitals`** table (`:247-254`); `appointments` reason/notes/cancellationReason (`:259-266`). `erasedCounts` derived from actual rows. The two most-recently-added PHI tables (imaging_attachments, vitals) ARE covered — no table missed.
- **Residual:** (a) `audit_logs` deliberately NOT erased (append-only, 7-yr, ADR-005 — correct). (b) **Blackout mismatch:** `erasureBlackoutUntil = now + config.backupRetentionDays`, default **7** (`config.ts:100`), but ADR-005 documents 30-day daily / 1-year weekly backups → the blackout marker can expire while GPG backups still hold pre-erasure PHI. Advisory-marker inaccuracy, not a live-DB residue gap.
- **Validation required:** `erasure.integration-db.test.ts` exists; NOT-EXECUTED. Confirm no PHI table added post-0038 is missing.
- **Falsification hypothesis:** *If* erasure is complete, post-execute SELECTs on every clinical table for the patient return only `[ERASED]`/NULL PHI. Disconfirming: any table holds cleartext PHI → incomplete (code review found none).
- **Improvement Engine:** *Problem* blackout (7 d) < backup retention (30 d/1 yr) → restore drills can reintroduce erased PHI past the marked window. *Root cause* reuses `backupRetentionDays` daily default. *Recommendation* set blackout to the longest backup retention (365 d) or a dedicated `ERASURE_BLACKOUT_DAYS`; doc in RUNBOOK §2.2. *Complexity* Low · *Risk* Low · *Priority* P3 · *Effort* ~1 h · *Metric* blackout ≥ longest retention.

### AUD-CMP-07 · RLS dormant outside `runInTenantContext` — bare-`db` read exposes all-tenant plaintext PHI
- **Category:** Access control / §164.312(a)(1) / threat model · **Severity:** Medium · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** `0015_enable_rls.sql:86-98` — `tenant_isolation` USING is TRUE whenever `app.rls_enforce <> 'on'` (dormant default). Enforcement only inside `runInTenantContext`. Bare `db`/`dbUnsafe` paths exist: `consent.service.ts` `hasActiveConsent`, `break-glass.service.ts:224` velocity, `medical-records.service.ts:109,118,122,157,166` create/update. Those rely on hand-written `eq(clinicId)`; RLS does not backstop them. A compromised process (holding the field key in-memory) can query across clinics and decrypt.
- **Supporting:** Documented rollout model (ADR-008/CLAUDE.md): dormant so `dbUnsafe` readers don't return zero rows (the `0022`→`0025` schedule incident).
- **Contradicting:** ESLint blocks bare `db` in services; belt-and-braces `eq(clinicId)` present on reviewed sites → honest code is tenant-safe. Exposure is the compromised-process / forgotten-filter axis.
- **Assumptions:** Some PHI writes/reads run outside tenant context (confirmed: clinical create/update).
- **Alternative explanations:** ADR-008 trade → residual risk, borderline finding (not drift).
- **Validation required:** bare cross-clinic SELECT as `medicore_app` returns foreign rows. NOT-EXECUTED.
- **Risk if incorrect:** Low.
- **Falsification hypothesis:** *If* RLS stops a rogue query, a bare cross-tenant SELECT as `medicore_app` returns zero foreign rows. Disconfirming (expected): foreign rows returned → dormancy confirmed.
- **Improvement Engine:** *Problem* backstop engages only inside tenant context; the top threat can skip it. *Root cause* dormant-by-default for legacy readers. *Recommendation* finish the `runInTenantContext` conversion of remaining PHI read+write sites, then set `ALTER ROLE medicore_app SET app.rls_enforce='on'` (enforce-by-default), exempting explicit governance queries; integration-test that bare cross-tenant reads now return zero. *Complexity* Med-High · *Risk* Med (convert callers first) · *Migration* convert → suites green → flip default behind rehearsal. *Rollback* reset role GUC. *Effort* ~2-3 d. *Priority* P2. *Metric* bare cross-tenant SELECT returns 0 rows.

### AUD-CMP-08 · Audit append-only + chain integrity — VALIDATED STRONG (no finding)
- **Category:** Audit integrity / §164.312(b),(c)(1) · **Severity:** Info · **Confidence:** High · **Evidence Strength:** Strong
- **Evidence:** `0026` revokes UPDATE/DELETE on `audit_logs` + existing partitions from `medicore_app` (keeps SELECT+INSERT). `0028` adds a `SECURITY DEFINER` `ddl_command_end` event trigger auto-revoking UPDATE/DELETE on any new `audit_logs` partition (self-healing vs the 0020 default-privs re-grant) + a current-partition backstop loop. Outbox drain only INSERTs (`audit.ts:149`). Nightly record + **verify** (`verifyRecentIntegrity`/`verifyChainLinkage`). Matches ADR-005; no drift.
- **Residual:** event trigger must be created as superuser at migration time (documented). Firing NOT-EXECUTED.

### AUD-CMP-09 · jti replay defense inert — DELIBERATE per ADR-007 (no finding)
- **Category:** Access control · **Severity:** Info · **Confidence:** High
- **Evidence:** Per ADR-007/CLAUDE.md, `markJtiUsed` called by no production route (latent), `privileged` scope only. Explicit scoping, not a bug. Residual: replayed privileged token not rejected on jti grounds; mitigated by short TTL + fph binding + fail-closed revocation. **Cross-ref Auth specialist.**

---

## 3. HIPAA §164.312 / GDPR MAPPING

| Control | Requirement | Status | Evidence |
|---|---|---|---|
| §164.312(a)(1) Access control | RBAC, tenant isolation | Partial — RLS dormant outside tx (AUD-CMP-07) | 0015/0017/0020 |
| §164.312(a)(2)(ii) Emergency access | Break-glass | PASS (durable audit, TTL, approval) | AUD-CMP-04 |
| §164.312(b) Audit controls | Record + examine | Partial — best-effort read audit (AUD-CMP-01); append-only PASS (AUD-CMP-08) | audit.ts / 0026 / 0028 |
| §164.312(c)(1) Integrity | Detect alteration | PASS — hash chain + verify + append-only | 0010 / 0026 |
| §164.312(d) Person/entity auth | JWT EdDSA + fph | Cross-ref Auth specialist | — |
| §164.312(e)(1) Transmission | TLS (Caddy), SSE IDs-only | Out of scope (infra) | — |
| §164.514 Identifiers | Insurance/national ID | Plaintext at rest (§1.2; logs AUD-CMP-05) | schema/patients.ts |
| GDPR Art. 17 erasure | Complete PHI scrub | PASS (all tables) + blackout mismatch (AUD-CMP-06) | erasure.service.ts |
| GDPR Art. 6/9 consent | Lawful basis before processing | Service-only gate (AUD-CMP-03) | consent/medical-records/prescriptions |

---

## 4. NOT-EXECUTED (require live DB / Docker)

- Encryption-adequacy falsification (dump-and-grep for cleartext name/national ID).
- AUD-CMP-01 fault injection (outbox insert throws → read still 200).
- AUD-CMP-03 raw-insert-without-consent DB rejection.
- AUD-CMP-06 post-erasure per-table residue scan; blackout-vs-backup-retention.
- AUD-CMP-07 bare cross-tenant SELECT as `medicore_app` returns foreign rows.
- AUD-CMP-08 event-trigger fires on new partition; `verifyChainLinkage` on tampered row.
- Host full-disk/volume encryption confirmation (out of repo).

## 5. FILES NOT REVIEWED (relevant, deferred)

- `lib/db/src/tenant-context.ts` (GUC set mechanics — inferred from 0015, not read line-by-line).
- Imaging download endpoint authZ (`GET /{xray|ultrasound}/:id/images/:attId`).
- `modules/audit/*` audit-log export endpoint (compliance export path).
- Full `logger.*` inventory outside `modules/` (lib/, middlewares/).
