// @ts-check
import js from "@eslint/js";

export default [
  js.configs.recommended,
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
];
