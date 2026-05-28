# Backup Encryption Key Management

This document is the authoritative procedure for the GPG keypair that
`scripts/backup-verify.mjs` uses to encrypt PostgreSQL backups.

> **Losing both halves of this key (the offline private key and every escrow
> copy) means every existing backup is permanently unrecoverable, even by
> someone with full access to the storage destination.** Treat the private
> key with the same care as the `FIELD_ENCRYPTION_KEY` (see P1).

---

## Roles and where each lives

| Material | Lives on | Used by | Quantity |
|---|---|---|---|
| **Backup public key** | every host that runs `backup-verify.mjs` (prod, staging, CI restore-drill) | `gpg --encrypt --recipient` step | 1, shared |
| **Backup private key** | offline restore workstation only | `gpg --decrypt` during a real restore | 1 active |
| **Escrowed private key** | sealed paper envelope in physical safe + encrypted backup on a second admin's offline machine | only opened on a declared disaster | ≥ 2 copies |

The public key is **not** secret — it can sit in the git repo or be served from
any internal HTTP location. The private key never lives on a production host;
encryption is one-way at the application boundary.

---

## Initial generation (one-time)

Run on an air-gapped Linux laptop, ideally booted from a live-USB:

```sh
# 1. Generate an RSA 4096 keypair with no expiry (rotate manually — see below)
gpg --batch --full-generate-key <<EOF
%no-protection
Key-Type: RSA
Key-Length: 4096
Subkey-Type: RSA
Subkey-Length: 4096
Name-Real: MediCore Backups
Name-Email: backups@medicore.internal
Expire-Date: 0
EOF

# 2. Note the long key ID
gpg --list-keys --keyid-format LONG backups@medicore.internal

# 3. Export the public key (this is what goes on every prod host)
gpg --armor --export backups@medicore.internal > medicore-backups.pub.asc

# 4. Export the private key — handle with extreme care
gpg --armor --export-secret-keys backups@medicore.internal > medicore-backups.priv.asc

# 5. Print three paper copies of the private key (paperkey is ideal)
paperkey --secret-key medicore-backups.priv.asc --output medicore-backups.paperkey.txt
lp medicore-backups.paperkey.txt   # or print from a non-networked printer
```

Place printed copies into tamper-evident envelopes, signed across the seal by
two distinct admins, and store in **two geographically separate safes** (e.g.,
office safe + bank deposit box). Record the safe locations in the on-call
runbook under "Disaster recovery — sealed envelopes."

Shred `medicore-backups.priv.asc` after the paper copies are verified readable.

---

## Distributing the public key to production hosts

```sh
# On the host that will run backup-verify.mjs (or in the api container build):
gpg --import medicore-backups.pub.asc
gpg --list-keys                 # confirm import

# Set in the environment that runs the script:
export BACKUP_GPG_RECIPIENT="backups@medicore.internal"
# or the long key ID for exactness:
# export BACKUP_GPG_RECIPIENT="0xABCDEF0123456789"
```

Add `BACKUP_GPG_RECIPIENT` to your `.env` / secrets manager.
`backup-verify.mjs` enforces its presence in production via the `NODE_ENV`
check at the top of `checkEnv()`.

---

## Restore drill — proving the chain works

Performed weekly automatically (`backup-verify.mjs` runs encryption + the local
decrypt-and-inspect step on every run) and **quarterly with full replay**:

```sh
# On the offline restore workstation:
gpg --import medicore-backups.priv.asc      # if not already present

# Set up an ephemeral Postgres for the drill:
docker run --rm -d --name drill-pg -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:16-alpine
export RESTORE_DATABASE_URL="postgresql://postgres:drill@localhost:55432/postgres"
export DATABASE_URL="$RESTORE_DATABASE_URL"   # script needs it set for the env check, but won't dump from it
export BACKUP_STORAGE_PATH="./drill-backups"
export BACKUP_GPG_RECIPIENT="backups@medicore.internal"

# Copy yesterday's encrypted backup down from offsite first, then:
node scripts/backup-verify.mjs --restore
```

A passing run prints `Restore drill replayed successfully` and
`Post-restore sanity check passed — patients table has N rows`. A failing run
exits non-zero — wire that to PagerDuty / Slack alert so a missed drill pages
on-call.

---

## Rotation policy

| Trigger | Action |
|---|---|
| Annual cadence | Generate a new keypair; add new public key to every host; keep the old private key in escrow indefinitely for legacy backups |
| Suspected private-key compromise | Generate new keypair immediately; re-encrypt the last 30 days of backups locally; revoke old key in the keyring |
| Admin departure | If the departing admin held an escrow copy, retrieve it and replace the seal |

**Never** delete an old private key while any backup encrypted with the matching
public key still exists offsite.

---

## Operational notes

- `gpg --batch` is required in scripts — the default interactive prompt hangs `pg_dump | gpg | ...` pipelines forever.
- `--trust-model always` skips the "is this key trusted?" prompt. Acceptable here because the keyring is curated by us; do not generalize this flag to user-facing tooling.
- Encrypted backups have a `.sql.gz.gpg` suffix. The retention sweep in `backup-verify.mjs` matches both `.sql.gz` and `.sql.gz.gpg` so legacy plaintext backups are still cleaned up.
- The script enforces encryption when `NODE_ENV=production`. Staging without GPG is fine; running production unencrypted fails the env check.

---

## Cross-references

- `scripts/backup-verify.mjs` — script that consumes `BACKUP_GPG_RECIPIENT`
- `.env.prod.example` — env-var template
- `docs/HEALTH_STATUS.md` — backup-related risks in "Remaining risks"
- Plan items: D3 (encrypted backups), P3 (offsite + decryption verification), P1 (field-encryption key escrow — same procedural pattern as this)
