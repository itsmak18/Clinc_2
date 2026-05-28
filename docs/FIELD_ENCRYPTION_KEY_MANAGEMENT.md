# Field Encryption Key Management

This document is the authoritative procedure for `FIELD_ENCRYPTION_KEY` — the
single AES-256-GCM key that `lib/field-encryption.ts` uses to encrypt PHI
fields at rest (`diagnosis`, `vitals`, `medications`, `allergies`,
`emergencyContact`, …).

> **Losing every copy of this key permanently bricks every encrypted PHI
> field in every backup and every live row.** AES-GCM is symmetric — there
> is no public/private split, no recovery via the database, no "reset"
> path. Treat the key with the same care as the safe combination of a
> physical records room.
>
> This is the same risk class as the GPG backup key documented in
> [BACKUP_KEY_MANAGEMENT.md](BACKUP_KEY_MANAGEMENT.md), but with **higher
> blast radius** — losing the GPG key only loses backups; losing this key
> loses the live database too.

---

## What the key looks like

```
FIELD_ENCRYPTION_KEY=64-char-hex-string   # exactly 64 hex chars (256-bit AES)
```

Anything else is rejected at process start with:

```
FIELD_ENCRYPTION_KEY must be exactly 64 hex characters (256-bit AES key)
```

The module also throws if the var is missing and `NODE_ENV=production`, so
booting a prod container without the key is impossible by construction.

---

## Generation (one-time)

Run on an air-gapped Linux laptop, ideally booted from a live-USB so no
residue is left on persistent storage:

```sh
# Cryptographically strong 256-bit key (64 hex chars):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → 5c8f...a91b   (example only — never reuse a sample key)
```

**Capture the key once.** Do not pipe it through tools that buffer
(shell history, less, tee → log files, etc.). The clipboard is acceptable
only on the air-gapped machine.

---

## Escrow — three-of-five Shamir split

`FIELD_ENCRYPTION_KEY` is too important to live in any single safe, but
giving five admins each a full copy is too much exposure. Standard pattern:
**Shamir's Secret Sharing**, 3-of-5 threshold.

```sh
# On the same air-gapped machine, install ssss-split (apt: ssss):
echo -n "<the 64-hex key>" | ssss-split -t 3 -n 5 -w medicore-fek
# Outputs five lines, each one a share. Any 3 reconstruct the key.
```

Distribute the five shares so that **no single physical location holds
three**:

| Share | Recipient | Storage |
|---|---|---|
| 1 | Founder / CTO | Personal safe at home |
| 2 | Operations lead | Office safe |
| 3 | Compliance officer | Office safe (separate building if possible) |
| 4 | Legal counsel | Their firm's deposit box |
| 5 | Bank safe-deposit box | Sealed envelope under company name |

Each share is sealed in a tamper-evident envelope, signed across the seal by
the holder + one witness. Record the holder names and seal IDs in
`docs/DECISIONS/` (under sealed-record ADR) — not the share contents.

> **Why 3 of 5?** Loss of two shares (lost envelope, dead admin, robbery)
> still allows recovery. Compromise of two shares still does not reveal the
> key. Five holders mean rotation can preserve continuity when one person
> leaves.

---

## Distribution to production hosts

The runtime never sees the Shamir shares. It only sees the reconstructed
key, as `FIELD_ENCRYPTION_KEY` in its environment, sourced from your
secrets manager (Docker secrets, SOPS-encrypted-in-git, Vault, etc.).

For the bundled `docker-compose.prod.yml`:

1. `.env` on the deploy host contains `FIELD_ENCRYPTION_KEY=<hex>`.
2. File mode is `0600`, owned by the deploy user.
3. The api container reads it via the `environment:` block. (Moving this to
   a `/run/secrets/*` file is queued as the full-A10 follow-up — keeps the
   key out of `docker inspect` output.)

The bundled compose's `:?` enforcement (plan A2) makes a missing key a
boot-time failure, not a runtime surprise.

---

## What to do if a share is lost

1. **Within 24 hours**: the holder reports the loss to the on-call rotation.
2. **Within 1 week**: generate a fresh 3-of-5 split of the *same* key (not a
   new key — the existing one stays in use; only the shares rotate).
3. Distribute the new shares; destroy the remaining old shares (shred the
   envelopes, confirm with witness).
4. Record the rotation in the same ADR that holds the seal-ID log.

Losing a single share is **not** a key-rotation event. The key has not been
compromised — only one share of a 3-of-5 split. The remaining 4 shares are
still sufficient.

---

## What to do if the key is suspected compromised

Loss of three or more shares simultaneously, or any indication that the
plaintext key has been seen by an unauthorized party (logs, screenshare,
backup tape stolen, etc.) is a SEV-1.

1. Page on-call. Treat as a confirmed PHI breach until proven otherwise.
2. **Rotation procedure** (this is the hard one — see [Rotation](#rotation)
   below). Plan to be down for several hours on a maintenance window.
3. Notify the compliance officer; start the 72-hour breach-notification
   clock (P2 plan item — playbook tracked separately).

---

## Rotation

Field-encryption key rotation is **destructive** in this codebase today —
the envelope format `enc:v1:<iv>:<tag>:<data>` has no key ID, so we cannot
mix v1 and v2 ciphertext in the same DB. Plan item B9 calls for adding
`enc:v2:<keyid>:...` + dual-read to enable seamless rotation. **Until B9
ships, rotation requires downtime.**

Procedure (with v1 envelopes, downtime required):

1. Schedule maintenance window. Stop the api containers.
2. Generate the new key. Escrow it (new Shamir split).
3. Run a one-off migration script that, for each encrypted column:
   - reads with the OLD key
   - re-encrypts with the NEW key
   - writes back in a single transaction
4. Verify a sample of decrypted rows match expected plaintext.
5. Rotate `FIELD_ENCRYPTION_KEY` in `.env`.
6. Bring api containers back.
7. Destroy old key material once monitoring confirms steady state for 7
   days (in case rollback is needed).

Procedure (post-B9, dual-read):

1. Generate new key + new keyid (e.g., `2`).
2. Add new key to `.env` as `FIELD_ENCRYPTION_KEY_V2`; old key stays as
   `FIELD_ENCRYPTION_KEY_V1`.
3. Deploy — writes use v2, reads accept either.
4. Background re-encrypt sweep.
5. Once all v1 rows are gone, remove v1 key + escrow shares.

---

## Disaster recovery — reconstructing the key

A reconstruction is necessary when:

- The single live copy on the prod host is destroyed (disk failure with no
  backup of the env file).
- The host environment is being rebuilt from scratch.

Steps:

1. Three share-holders convene physically (not over Zoom — the envelopes
   must come out of safes together so each can verify the seals).
2. Open three envelopes; record the share content for the rebuild only.
3. On an air-gapped laptop:
   ```sh
   ssss-combine -t 3 -w medicore-fek
   # → paste the three shares when prompted, get the 64-hex key out
   ```
4. Type the key directly into the destination `.env` file (no clipboard
   that touches a network-connected machine).
5. Re-seal three fresh envelopes with the same share content (envelopes are
   compromised after opening; the shares themselves are not).
6. Return shares to their respective safes; record the reconstruction in
   the ADR.

> **Never** photograph, scan, or transmit any share over a network or
> messaging platform. Doing so reduces the threshold from 3 to whatever
> attack surface the channel has.

---

## Cross-references

- `artifacts/api-server/src/lib/field-encryption.ts` — the module that
  consumes `FIELD_ENCRYPTION_KEY`.
- `.env.prod.example` — production env-var template.
- Plan items: P1 (this procedure), B9 (envelope versioning for seamless
  rotation), P2 (breach notification playbook that consumes this).
- [BACKUP_KEY_MANAGEMENT.md](BACKUP_KEY_MANAGEMENT.md) — parallel procedure
  for the GPG backup key. The two keys are separate by design — a leak of
  one does not compromise the other.
