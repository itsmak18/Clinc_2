# Coding Conventions

Human-readable standards for every contributor. Extracted 2026-07-11 from
`.claude/CLAUDE.md` (which remains the AI-assistant operating file); when the
two disagree, fix both in the same PR. Priority order for trade-offs:
**Correctness → Security → Performance → Maintainability → DX.**

## Tenancy & data access (CI-enforced)

- Every query against a clinic-bearing table runs inside
  `runInTenantContext()` (RLS). The raw client `dbUnsafe` is allowed only
  with an adjacent **line comment** `// dbUnsafe: <justification>` — the CI
  guard checks that exact form (a docblock mention does not count).
- Doctors access only their assigned patients — use the `lib/scope.ts`
  helpers (`assertPatientInScope` throws; never re-implement as a bool
  check). Pass returned `breakGlassPatientIds` into `runInTenantContext`.
- `super_admin` bypasses all role checks at every layer — never block it.
- `audit_logs` is append-only; writes go through the outbox, never direct.

## Backend structure

- Feature modules under `src/modules/<feature>/` (`*.routes.ts` = HTTP only,
  `*.service.ts` = queries/rules/audit, no Express types in services, no DB
  imports in routes).
- Cross-module imports go through the target module's `index.ts` barrel only
  (CI greps deep `modules/x/x.service` paths).
- Route registration in `src/routes/index.ts` keeps anonymous-before-authed
  `router.use()` order.
- All async handlers wrapped in `asyncHandler()`; auth via
  `authGate(scope, roles?)`; body validation via `validate(SchemaBody)` from
  `@workspace/api-zod` on POST/PUT/PATCH (after auth, before handler).
  `validate()` validates only — it never mutates `req.body`.

## API contract

- Contract changes start in `lib/api-spec/openapi.yaml` → regenerate client
  + zod. **Never hand-edit files under `src/generated/`.**
- Request schemas model *client input* — no server-set (`createdById`) or
  computed (`total`) fields; fix the spec, not the consumer.
- Error responses use the stable numeric code registry (`src/errors.ts`,
  validated by `validate:errors` in CI). New errors get a new code — codes
  are append-only.
- Pagination is cursor-based. `offset:` params are forbidden (CI grep;
  `AuditLog.tsx` is the sole sanctioned exception).

## Frontend

- Bayan design system classes (`.page`, `.card`, `.btn btn-primary`,
  `.badge`) — do NOT import `PageHeader`/`Button`/`Badge` from
  `components/ui/*` in app code (shadcn primitives are internal to ui/).
- Logical Tailwind properties only: `ms/me/ps/pe`, never `ml/mr/pl/pr`
  (RTL support).
- Every user-facing string via `useI18n()`; add the key to BOTH
  `hooks/locales/en.ts` and `ar.ts` — the parity test fails CI otherwise.
  Arabic values are always optional in data models.
- Pages import lazily in `App.tsx`; new routes get `<Guard>` +
  an entry in `lib/route-access.ts` (sidebar reads it automatically).
- `document.write` is forbidden outside the two reviewed print sinks
  (`lib/print.ts`, `DischargeSheet.tsx`) — CI grep. Printing goes through
  `openPrintWindow()` with `escapeHtml()` on every dynamic field.
- Raw `fetch` to `/api/*` is forbidden in pages — use the generated hooks.

## Validation

- `drizzle-zod` (`createInsertSchema`) for DB-shaped validation; import zod
  from `"zod/v4"`. Never hand-write a Zod schema for a table that has a
  Drizzle schema.

## Database & migrations

- Schema files: one table per file in `lib/db/src/schema/`.
- **Migration naming (policy since 2026-07-11):** always
  `pnpm drizzle-kit generate --name <descriptive-slug>` — auto-generated
  Marvel names (`0042_late_typhoid_mary.sql`) are unreviewable at incident
  time. Hand-written SQL migrations keep the same `NNNN_slug.sql` form.
- Never edit an applied migration; add a new one.

## Dependency & supply chain

- pnpm only (`preinstall` rejects npm/yarn). `minimumReleaseAge: 1440`.
- **All overrides live in `pnpm-workspace.yaml`** — never add a
  `pnpm.overrides` block to `package.json`: it silently takes precedence
  and disables the workspace-file block entirely (root cause of the inert
  security pins found 2026-07-11). Every override carries a CVE/GHSA
  comment.
- Base images in Dockerfiles are digest-pinned; GitHub Actions from third
  parties are SHA-pinned.

## Naming

- Files: kebab-case (`auth-gate.ts`, `use-idle-timeout.ts`). Legacy
  camelCase files are renamed opportunistically when otherwise touched.
- Frontend hooks: `use-<thing>.ts` exporting `useThing`.

## Documentation

- Every audit/review lands in `docs/audits/` and adds a row to
  [`docs/audits/INDEX.md`](audits/INDEX.md); PRs that close findings update
  the status column in the same PR.
- Consequential design choices get an ADR in `docs/adr/` (numbered,
  append-only).
- Working trees never live under cloud-synced folders (OneDrive/Dropbox) —
  see `docs/SECRET_ROTATION_2026-07-11.md` for why.

## Commits

- Conventional Commits (`feat(billing): …`, `fix(ci): …`). Body explains
  *why* when non-obvious. Never commit generated-file edits separately from
  the spec change that produced them.
