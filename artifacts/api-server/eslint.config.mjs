// @ts-check
import tseslint from "typescript-eslint";

/**
 * Scope of this ESLint config:
 *
 *   1. Route boundary (existing): block `@workspace/db` / `drizzle-orm` in
 *      `src/routes/**`. Routes must delegate all DB access to the service layer.
 *
 *   2. RLS backstop guard (F-07 from 2026-06-01 audit): block the raw `db`
 *      named export from `@workspace/db` in `src/services/**`. Services that
 *      touch clinic-bearing tables MUST route queries through
 *      `runInTenantContext(req.user!, async (tx) => …)` so that RLS enforces
 *      in production (medicore_app role, NOSUPERUSER NOBYPASSRLS).
 *
 *      Escape hatch for legitimately non-tenant paths (tables with no clinicId:
 *      login_attempts, device_verification_tokens, password_reset_tokens,
 *      csp_reports, doctor_schedules, schedule_overrides, audit_outbox drain,
 *      health checks): import `dbUnsafe` from `@workspace/db` instead of `db`,
 *      and add a one-line justification comment at the import site.
 *
 *   4. Cross-module barrel guard (2026-07-02 architecture audit, F4): block deep
 *      `../<module>/<file>.service` imports — a module's public surface is its
 *      `index.ts` barrel. Four places, by file shape:
 *        4a (folded into rule 1): `*.routes.ts` — pattern added to rule 1's own
 *           `patterns` array, not a separate config object.
 *        4b (folded into rule 2): `*.service.ts` — pattern added to rule 2's own
 *           `patterns` array, alongside its existing `paths` guard.
 *        4c (own block below): everything else under `src/modules/**` (barrels,
 *           helper files like `schedule.slots.ts`) — `ignores` excludes
 *           `*.routes.ts`/`*.service.ts` so it never overlaps rules 1/2's files.
 *        4d (own block below): `src/lib/**` and `src/middlewares/**` reaching
 *           INTO a module (`../modules/<m>/<file>.service` — one segment deeper
 *           than 4a-4c's shape; found live in `lib/scope.ts`).
 *      4a/4b are folded into rules 1/2 rather than added as separate config
 *      objects because ESLint flat config REPLACES, not merges, a rule's options
 *      when two config objects targeting the same rule name both match a file —
 *      a standalone block scoped to `src/modules/**` sits *after* rules 1/2 in
 *      the array and would silently clobber their guards for every
 *      `*.routes.ts`/`*.service.ts` file. Caught in review before landing: a
 *      probe `db` import in a `.routes.ts`/`.service.ts` file stopped erroring
 *      once the wider, later-declared block also set `no-restricted-imports`.
 *      4c/4d are safe as separate blocks only because their `files`/`ignores`
 *      are constructed to never overlap rules 1/2's globs.
 *
 * `tseslint.configs.base` gives us the TS parser without type-aware checks
 * (no `parserOptions.project`), so the run stays fast.
 */
export default tseslint.config(
  tseslint.configs.base,
  // ── 1. Route boundary + cross-module barrel guard (routes) ─────────────────
  // Covers both the legacy `src/routes/**` layout and the feature-module layout
  // (`src/modules/<m>/<m>.routes.ts`) so the guard follows files as they migrate.
  {
    files: ["src/routes/**/*.ts", "src/modules/**/*.routes.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@workspace/db", "drizzle-orm"],
              message:
                "Route files must not import DB or Drizzle directly. Move all DB access into a service file under src/services/.",
            },
            {
              group: ["../*/*.service"],
              message:
                "Cross-module service imports must go through the target module's index.ts " +
                "barrel (e.g. `from \"../clinical\"`), not a deep `../<module>/<file>.service` " +
                "path. Re-export the function from that module's barrel if it isn't already.",
            },
          ],
        },
      ],
    },
  },
  // ── 2. RLS backstop guard + cross-module barrel guard (services) ───────────
  // Covers legacy `src/services/**` and feature-module service files
  // (`src/modules/<m>/<m>.service.ts`).
  {
    files: ["src/services/**/*.ts", "src/modules/**/*.service.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@workspace/db",
              importNames: ["db"],
              message:
                "Services must not import the raw `db` client — it bypasses RLS when " +
                "the app connects as medicore_app (NOSUPERUSER NOBYPASSRLS). " +
                "Route clinic-bearing queries through runInTenantContext(req.user!, tx => …). " +
                "For tables with no clinicId (device tokens, schedule slots, csp_reports, etc.) " +
                "import `dbUnsafe` instead and add a one-line justification comment.",
            },
          ],
          patterns: [
            {
              group: ["../*/*.service"],
              message:
                "Cross-module service imports must go through the target module's index.ts " +
                "barrel (e.g. `from \"../compliance\"`), not a deep `../<module>/<file>.service` " +
                "path. Re-export the function from that module's barrel if it isn't already.",
            },
          ],
        },
      ],
    },
  },
  // ── 3. Typed config guard ─────────────────────────────────────────────────────
  // All source files must read env through lib/config.ts, not process.env.
  // Migration complete as of 2026-06-29 — severity is "error" to block
  // regressions permanently.
  // Exempt: config.ts (the definition), tests (set env before import), scripts.
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/lib/config.ts",
      "src/tests/**",
      "src/scripts/**",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read env through 'lib/config' (config.ts) instead of process.env directly. " +
            "See docs/ARCHITECTURE_AUDIT_2026-06-29.md §4.",
        },
      ],
    },
  },
  // ── 4a. Cross-module barrel guard (barrels + any other non-route/non-service
  //        module file) ────────────────────────────────────────────────────────
  // `ignores` excludes `*.routes.ts`/`*.service.ts` because those already carry
  // this same pattern folded into rules 1/2 above — this block only needs to
  // catch it for `index.ts` barrels and any other file directly under a module
  // (e.g. `clinical/schedule.slots.ts`) that rules 1/2 don't reach.
  {
    files: ["src/modules/**/*.ts"],
    ignores: ["src/modules/**/*.routes.ts", "src/modules/**/*.service.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*/*.service"],
              message:
                "Cross-module service imports must go through the target module's index.ts " +
                "barrel (e.g. `from \"../clinical\"`), not a deep `../<module>/<file>.service` " +
                "path. Re-export the function from that module's barrel if it isn't already.",
            },
          ],
        },
      ],
    },
  },
  // ── 4b. Cross-module barrel guard (kernel → module) ─────────────────────────
  // Files under src/lib/ (and other non-modules/ layers) reach into a module via
  // `../modules/<m>/<file>.service` — one path segment deeper than the intra-modules
  // shape above (found live in `lib/scope.ts`, which imported
  // `../modules/compliance/break-glass.service` directly instead of the barrel).
  {
    files: ["src/lib/**/*.ts", "src/middlewares/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../modules/*/*.service", "**/modules/*/*.service"],
              message:
                "Cross-module service imports must go through the target module's index.ts " +
                "barrel (e.g. `from \"../modules/compliance\"`), not a deep " +
                "`../modules/<module>/<file>.service` path. Re-export the function from that " +
                "module's barrel if it isn't already.",
            },
          ],
        },
      ],
    },
  },
  {
    // Ignore everything outside routes/**, services/**, and the new typed-config
    // guard scope so the run stays fast.
    ignores: [
      "dist/**",
      "node_modules/**",
    ],
  },
);
