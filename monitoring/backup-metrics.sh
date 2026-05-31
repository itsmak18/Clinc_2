#!/bin/sh
# Write backup success timestamp for Prometheus textfile collector.
# Invoked by the backup container after backup-verify.mjs exits 0.
# node_exporter --collector.textfile.directory=/metrics picks this up.
set -eu
METRICS_DIR="${METRICS_TEXTFILE_DIR:-/metrics}"
mkdir -p "$METRICS_DIR"
TMP="$METRICS_DIR/backup.prom.$$"
cat > "$TMP" <<EOF
# HELP backup_last_success_timestamp_seconds Unix timestamp of last successful backup.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds $(date +%s)
EOF
mv "$TMP" "$METRICS_DIR/backup.prom"
