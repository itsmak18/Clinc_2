# `./secrets/` — runtime secret files mounted into containers

Docker Compose mounts files from this directory into containers as
`/run/secrets/<name>` (read-only, in-memory tmpfs).

**Never commit anything except this README and `.gitignore`.**

## Required files (production)

| File | Permissions | How to generate |
|---|---|---|
| `postgres_password` | `chmod 600`, owned by deploy user | `openssl rand -base64 48 \| tr -d '\n' > ./secrets/postgres_password` |
| `redis_password` | `chmod 600`, owned by deploy user | `openssl rand -base64 48 \| tr -d '\n' > ./secrets/redis_password` |
| `session_secret` | `chmod 600`, owned by deploy user | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > ./secrets/session_secret` |
| `field_encryption_key` | `chmod 600`, owned by deploy user | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > ./secrets/field_encryption_key` |
| `metrics_token` | `chmod 600`, owned by deploy user | `openssl rand -hex 32 > ./secrets/metrics_token` |
| `jwt_private_key` | `chmod 600`, owned by deploy user | See pair generator below — **must be generated atomically with `jwt_public_key`** |
| `jwt_public_key` | `chmod 600`, owned by deploy user | See pair generator below |

**Generate the JWT key pair atomically** (both files must match; generating separately is an error):

```sh
node -e "
const c = require('crypto');
const kp = c.generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
});
require('fs').writeFileSync('./secrets/jwt_private_key', kp.privateKey);
require('fs').writeFileSync('./secrets/jwt_public_key',  kp.publicKey);
"
chmod 600 ./secrets/jwt_private_key ./secrets/jwt_public_key
```

**Losing `field_encryption_key` = total PHI loss.** Escrow it before first prod boot — see [docs/FIELD_ENCRYPTION_KEY_MANAGEMENT.md](../docs/FIELD_ENCRYPTION_KEY_MANAGEMENT.md). Rotation procedures live in [SECURITY.md](../SECURITY.md#secret-management).

## Why files instead of env vars

`environment:` values are visible to anyone who runs `docker inspect <container>`
and end up in process listings of any child spawned with that env. Files mounted
at `/run/secrets/*` are only readable by the container's user and never appear
in `docker inspect`.

The A10 follow-up (file-mount `SESSION_SECRET` / `FIELD_ENCRYPTION_KEY` / `METRICS_TOKEN`)
landed 2026-05-27. `REDIS_PASSWORD` file-mounted 2026-05-29. The api entrypoint
(`docker-compose.prod.yml` → api service `command:`) now reads `/run/secrets/*`
into env vars at container start, after a pre-flight check that fails fast if any
required file is missing or empty. `REDIS_URL` is assembled from the secret file
inside the entrypoint — it no longer appears in `docker inspect` output.
