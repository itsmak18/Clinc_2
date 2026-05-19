# Migration Notes — Lessons Learned / Deprecated Approaches

- **JWT in localStorage (C-01, removed)**: Token was stored as `clinic_token` in `localStorage`, sent via `Authorization: Bearer`. Replaced with HttpOnly SameSite=Strict cookie set by `POST /auth/login`. Never reintroduce localStorage for auth. Cookie max-age matches per-role JWT TTL (15m–4h), NOT a flat 8h.

- **SSE auth via `?token=` query param (removed)**: SSE now uses `new EventSource(url, { withCredentials: true })` — the HttpOnly cookie is sent automatically.

- **Raw `fetch()` without CSRF header**: Orval-generated `customFetch` attaches `X-CSRF-Token` automatically. Any hand-written `fetch()` to a mutation endpoint must read `_csrf` from `document.cookie` and set `X-CSRF-Token`. Failure silently breaks server-side logout revocation (the server rejects with 403 which callers may swallow).

- **`app.use("/api", middleware)` path stripping**: Express strips the mount prefix from `req.path` inside the mounted middleware. So a middleware mounted at `/api` sees `/auth/login`, not `/api/auth/login`. The v7 kernel is method-gated (not path-gated) to avoid this pattern entirely — no `CSRF_EXEMPT_PATHS` list.

- **CSRF middleware → v7 kernel**: `middlewares/csrf.ts` is deleted. CSRF now runs inside `evaluate()` in `lib/policy.ts` for mutation methods. The unit test suite is `tests/policy.unit.test.ts` (25 tests covering every kernel branch including CSRF). There is no `csrf.test.ts`.

- **`verifyToken` fail-open (fixed)**: Catch block previously did `console.warn` + returned the token. Now throws `"Token verification unavailable"`. Revocation store errors are fail-closed.

- **`logout()` without server-side revocation (fixed)**: `POST /auth/logout` calls `revokeAllTokensForUser(userId)` before clearing the cookie. Without this, captured JWTs survive for the full role TTL after logout.

- **`LoginResponse` schema drift (fixed)**: After moving the JWT to a cookie, `openapi.yaml` still had `token: string` as required. Always update `openapi.yaml` first when migrating auth approaches, then run codegen and verify generated types.

- **Orval `api-zod` barrel export (Windows)**: Orval `split` mode writes an invalid barrel on Windows (git-bash interprets `\\n` literally). After codegen fails: `printf "export * from './generated/api';\n" > lib/api-zod/src/index.ts`, then run `pnpm -w run typecheck:libs` separately. The full codegen script will not succeed end-to-end on Windows.

- **MFA removed (2026-05-18)**: TOTP two-step login was fully implemented (otplib, AES-256-GCM encrypted secrets, recovery codes, mfa_sessions table, challenge routes) then **completely removed** to restore single-step login. The `users` table has no MFA columns. No `mfa_sessions` table exists. No MFA routes exist. The `/mfa-setup` reference in `route-access.ts` is dead code (safe to remove). Do not implement MFA features until explicitly re-scoped.
