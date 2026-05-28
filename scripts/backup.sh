#!/bin/bash
# DEPRECATED — kept only so existing cron entries don't silently break.
# Use scripts/backup-verify.mjs directly. See docs/BACKUP_KEY_MANAGEMENT.md.
#
# This wrapper now requires the same env as backup-verify.mjs:
#   DATABASE_URL, BACKUP_STORAGE_PATH, BACKUP_GPG_RECIPIENT (in prod),
#   OFFSITE_UPLOAD_COMMAND (recommended).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/../.env" ]; then
  set -a; . "${SCRIPT_DIR}/../.env"; set +a
fi

echo "[backup.sh] Deprecated wrapper — forwarding to backup-verify.mjs" >&2
exec node "${SCRIPT_DIR}/backup-verify.mjs" "$@"
