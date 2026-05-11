#!/bin/bash
set -e

# Load environment variables if available
if [ -f .env ]; then
  source .env
fi

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set"
  exit 1
fi

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="medicore_db_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Starting database backup..."
# pg_dump using connection string
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/$FILENAME"

echo "Backup completed successfully: $BACKUP_DIR/$FILENAME"

# In a real production scenario, you would sync this to S3:
# aws s3 cp "$BACKUP_DIR/$FILENAME" s3://my-offsite-backups/
