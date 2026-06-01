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
 * `tseslint.configs.base` gives us the TS parser without type-aware checks
 * (no `parserOptions.project`), so the run stays fast.
 */
export default tseslint.config(
  tseslint.configs.base,
  // ── 1. Route boundary ──────────────────────────────────────────────────────
  {
    files: ["src/routes/**/*.ts"],
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
          ],
        },
      ],
    },
  },
  // ── 2. RLS backstop guard ──────────────────────────────────────────────────
  {
    files: ["src/services/**/*.ts"],
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
        },
      ],
    },
  },
  {
    // Ignore everything outside routes/** and services/** so the run is fast
    // and only the rules we care about can fire.
    ignores: [
      "src/lib/**",
      "src/middlewares/**",
      "src/tests/**",
      "src/scripts/**",
      "src/index.ts",
      "src/app.ts",
      "src/cron.ts",
      "src/errors.ts",
      "dist/**",
      "node_modules/**",
    ],
  },
);
