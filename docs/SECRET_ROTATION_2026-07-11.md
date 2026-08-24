# Secret Rotation Log — 2026-07-11

Context: the working tree (including gitignored `.env`, `.env.rehearsal`,
`secrets/`) lived under a OneDrive-synced folder until 2026-07-11
(`IMPROVEMENT_PLAN_2026-07-08.md` Phase 0.1/0.2). Every value that ever
existed there is treated as exposed to the OneDrive account.

## Inventory of the exposed files

| File | Contents | Secret material? |
|---|---|---|
| `.env` (dev) | `DATABASE_URL`, `PORT`, `NODE_ENV`, `SESSION_SECRET`, `BCRYPT_ROUNDS`, `CLINIC_TZ`, `BASE_PATH` | `SESSION_SECRET`; local-Docker Postgres password inside `DATABASE_URL` |
| `.env.rehearsal` | image digests, `POSTGRES_USER`/`POSTGRES_DB` (no password), `CADDY_DOMAIN`, `ALLOWED_ORIGINS`, `BACKUP_GPG_RECIPIENT` (public key id), `BACKUP_RSYNC_TARGET` | none |
| `secrets/` | `.gitignore` + `README.md` only — prod secrets are generated at deploy | none |
| `FIELD_ENCRYPTION_KEY` | **never present** in any exposed file (prod-only, generated at deploy) | n/a — no rotation needed |
| GPG backup private key | offline-only per `BACKUP_KEY_MANAGEMENT.md`; not in any exposed file | n/a — no rotation needed |

## Actions

| Secret | Action | When | Verified |
|---|---|---|---|
| `SESSION_SECRET` (dev) | regenerated (64-hex via CSPRNG), written to `C:\dev\medicore\.env` | 2026-07-11 | old JWTs invalid on next dev boot; forces dev re-login (acceptable) |
| Local Docker Postgres password | **pending next Docker Desktop start**: `ALTER USER` + update `DATABASE_URL` in `.env` | open | risk accepted meanwhile — DB binds localhost only, value useless without host access |
| Prod secrets | none existed in the exposed tree | — | — |

## Exposure cleanup

- 2026-07-11: OneDrive tree deleted — 0 files remain (4 empty dir husks held
  by a sync-engine handle; clear on reboot).
- **USER ACTION OPEN:** purge OneDrive web recycle bin + version history for
  `Desktop/Clinic-Hub` — deleted files stay recoverable in the cloud until then.
- Standing rule (RUNBOOK): working trees never live under synced folders.
