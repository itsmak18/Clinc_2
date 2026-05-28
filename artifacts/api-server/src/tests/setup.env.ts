// Vitest setup — runs once per worker before any test file imports.
//
// A1 (2026-05-26): the auth kernel now fail-closes when a token lacks `fph`.
// Production code paths thread request headers through signToken() so tokens
// always carry fph. Tests mint tokens directly without headers (intentional —
// they're testing things other than the fingerprint binding), so without an
// escape hatch every authenticated test would fail with AUTH_FINGERPRINT_REQUIRED.
//
// Setting FPH_GRANDFATHER_UNTIL to a far-future value treats every test-issued
// token as a legacy grandfathered token. Tests that DO want to exercise the
// new fail-closed behavior must explicitly override the env var inside their
// `describe` block (see policy.unit.test.ts A1 cases).
process.env.FPH_GRANDFATHER_UNTIL = process.env.FPH_GRANDFATHER_UNTIL ?? "9999999999";
