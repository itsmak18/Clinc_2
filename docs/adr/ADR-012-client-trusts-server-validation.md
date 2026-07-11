# ADR-012: Client Trusts Server Validation (no client-side Zod)

**Status:** Accepted
**Date:** 2026-07-11
**Supersedes:** —
**Related:** ADR-001 (Architecture Decisions); IMPROVEMENT_PLAN_2026-07-08 item 1.7(b); FRONTEND_REVIEW_2026-07-08 (forms)

---

## Context

`@workspace/api-zod` (Orval-generated Zod schemas from `openapi.yaml`) is consumed only by the backend's `validate()` middleware. The clinic frontend imports neither `@workspace/api-zod` nor `zod` at all — forms submit through the Orval-generated client and render the server's 400 error envelope (stable error codes + field messages). The 2026-07-07 structure audit flagged this as unverified ("if the client validates divergently, that's a bug farm") and required either adoption or an owned decision.

## Decision

The client deliberately performs **no schema validation**. There is exactly one first-party client, deployed in lockstep with the server; every request is validated server-side against the same generated schemas the spec produces, and the 400 envelope is the single source of validation truth rendered to users. Duplicating the generated Zod bundle client-side cannot catch anything the server does not already catch — it buys only pre-submit UX polish at the price of a second validation surface that can drift (schema version skew between deployed SPA and API during rolling deploys) and meaningful bundle weight. **Divergent validation is impossible today because client-side validation does not exist.**

Revisit per-form during Phase 4 forms work (FRONTEND_REVIEW_2026-07-08): if a specific form needs inline pre-submit feedback, it should import the relevant schema from `@workspace/api-zod` — never hand-write a parallel schema.
