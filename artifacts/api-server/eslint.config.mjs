// @ts-check
import tseslint from "typescript-eslint";

/**
 * Scope of this ESLint config: enforce the service-layer boundary by blocking
 * direct `@workspace/db` / `drizzle-orm` imports inside `src/routes/**`.
 *
 * That is the only purpose right now. Broader lint hygiene (unused vars,
 * Node globals, recommended rules across the whole codebase) is intentionally
 * out of scope — adding `js.configs.recommended` here surfaces hundreds of
 * unrelated findings that would block this PR. A dedicated lint-hygiene PR
 * can expand the surface later.
 *
 * `tseslint.configs.base` gives us the TS parser without type-aware checks
 * (no `parserOptions.project`), so the run stays fast.
 */
export default tseslint.config(
  tseslint.configs.base,
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
  {
    // Ignore everything outside routes/** so the run is fast and only the
    // one rule we care about can fire.
    ignores: [
      "src/lib/**",
      "src/services/**",
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
