# Audit Index

Single home for every audit/review report. **Rule (see `docs/CONVENTIONS.md`):
any PR that adds an audit or closes one of its findings updates this table.**
Naming: `<TYPE>_<YYYY-MM-DD>[_SCOPE].md`.

| Date | Report | Scope | Verdict | Findings status |
|---|---|---|---|---|
| 2026-06-02 | (memory/CHANGELOG only — pre-dates report convention) | Full security | — | F-01 print-XSS + inert controls — **all fixed** (CHANGELOG 06-02/06-03) |
| 2026-06-03 | [AUDIT_FINDINGS_2026-06-03_PHASE1](AUDIT_FINDINGS_2026-06-03_PHASE1.md) | P1 cross-tenant | fixed-in-pass | **Closed.** Migrations 0024–0026 validated in CI integration-db 2026-07-11 (PR #1) |
| 2026-06-03 | [AUDIT_FINDINGS_2026-06-03_PHASE2](AUDIT_FINDINGS_2026-06-03_PHASE2.md) | P2 auth | fixed-in-pass | Closed |
| 2026-06-04 | [AUDIT_FINDINGS_2026-06-04_PHASE3](AUDIT_FINDINGS_2026-06-04_PHASE3.md) | P3 HIPAA §164.312 | fixed-in-pass | Closed (F-P3-2 verified fixed, CHANGELOG 06-06) |
| 2026-06-03 | [AUDIT_FINDINGS_2026-06-03_PHASE4](AUDIT_FINDINGS_2026-06-03_PHASE4.md) | P4 audit chain | fixed-in-pass | Closed |
| 2026-06-06 | [AUDIT_FINDINGS_2026-06-06_PHASE5](AUDIT_FINDINGS_2026-06-06_PHASE5.md) | dbUnsafe/clinicId sweep | 5 findings fixed | Closed |
| 2026-06-07 | [AUDIT_FINDINGS_2026-06-07_PHASE6](AUDIT_FINDINGS_2026-06-07_PHASE6.md) | Observability | alert stack was inert; fixed | Closed except **runtime alert verify at first prod deploy** (folds into Phase 0.3 rehearsal) |
| 2026-06-07 | [AUDIT_FINDINGS_2026-06-07_PHASE7](AUDIT_FINDINGS_2026-06-07_PHASE7.md) | Frontend security | sound but sign-off rubber-stamped | Closed (route-access contract test written) |
| 2026-06-07 | [AUDIT_FINDINGS_2026-06-07_PHASE8](AUDIT_FINDINGS_2026-06-07_PHASE8.md) | Phase 8 re-verify | — | Closed (F-P8-1 CLAUDE.md doc drift — fixed) |
| 2026-06-14 | [AUDIT_FINDINGS_2026-06-14_PRINCIPAL](AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md) | Zero-trust re-audit | 8.4/10, no open criticals | Closed |
| 2026-06-22 | [AUDIT_FINDINGS_2026-06-22](AUDIT_FINDINGS_2026-06-22.md) | Full-repo security | 1 HIGH + 4 lower, all fixed | Closed |
| 2026-06-29 | [ARCHITECTURE_AUDIT_2026-06-29](ARCHITECTURE_AUDIT_2026-06-29.md) | Architecture | 8.5/10 | Superseded by 07-02 |
| 2026-07-01 | [ENGINEERING_AUDIT_2026-07-01](ENGINEERING_AUDIT_2026-07-01.md) (+ [appendix-2026-07-01/](appendix-2026-07-01/)) | Engineering board | 82/100 | See 07-02/07-07 supersessions |
| 2026-07-02 | [ARCHITECTURE_AUDIT_2026-07-02](ARCHITECTURE_AUDIT_2026-07-02.md) | Independent verification | strong; prod-run risk | Prod end-to-end run: **OPEN** → plan Phase 0.3 |
| 2026-07-07 | [ARCHITECTURE_AUDIT_2026-07-07_STRUCTURE](ARCHITECTURE_AUDIT_2026-07-07_STRUCTURE.md) | Structure review | 8/10 conditional | Tracked item-by-item in [IMPROVEMENT_PLAN_2026-07-08](../IMPROVEMENT_PLAN_2026-07-08.md); Phase 0 done except 0.3; Phase 1 in progress |
| 2026-07-08 | [FRONTEND_REVIEW_2026-07-08](FRONTEND_REVIEW_2026-07-08.md) | Frontend code-level | forms + copy-paste debt | Open → plan Phase 4 (revised) |
| — | [AUDIT_REPORT](AUDIT_REPORT.md), [SECURITY_REPORT_2.0](SECURITY_REPORT_2.0.md) | Early reports | historical | Superseded |

## Standing open items (cross-audit)

1. **Prod compose end-to-end rehearsal** (07-02 audit; plan 0.3) — includes the Phase-6 alert runtime-verify.
2. **Frontend feature modularization + forms** (07-08 review; plan Phase 4).
3. **CodeQL Security-tab triage** (2026-07-11): 5 medium/high alerts — `backup-verify.mjs` indirect-command-injection ×3, `app.ts:147` user-controlled-bypass, `imaging-storage.ts` http-to-file — plus ~45 stale note-level alerts pointing at pre-migration paths.
4. **OneDrive cloud-history purge** (user, manual) — see `docs/SECRET_ROTATION_2026-07-11.md`.
