#!/usr/bin/env node
/**
 * backup-verify.mjs
 *
 * Weekly backup verification script for MediCore PostgreSQL database.
 *
 * What it does:
 *   1. Dumps the production DB to a timestamped .sql.gz file
 *   2. Verifies the dump file is non-empty and has a valid gzip header
 *   3. Parses the SQL header to confirm it is a real pg_dump output
 *   4. (Optional) Restores to an ephemeral DB URL for quarterly restore tests
 *
 * Usage:
 *   node scripts/backup-verify.mjs
 *   node scripts/backup-verify.mjs --restore            # quarterly restore test
 *   node scripts/backup-verify.mjs --dry-run            # verify env only
 *
 * Required env vars:
 *   DATABASE_URL          — source (production) PostgreSQL connection string
 *   BACKUP_STORAGE_PATH   — local or mounted path to write backup files
 *
 * Optional env vars:
 *   RESTORE_DATABASE_URL  — ephemeral DB for restore test (--restore mode)
 *   BACKUP_RETENTION_DAYS — how many backups to keep (default: 30)
 *
 * Exit codes:
 *   0 — backup verified successfully
 *   1 — backup failed or verification failed
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { createGunzip } from "zlib";
import { createReadStream } from "fs";

// ── Configuration ─────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
const BACKUP_STORAGE_PATH = process.env.BACKUP_STORAGE_PATH ?? "./backups";
const RESTORE_DATABASE_URL = process.env.RESTORE_DATABASE_URL;
const BACKUP_RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS ?? "30", 10);

const args = process.argv.slice(2);
const DO_RESTORE = args.includes("--restore");
const DRY_RUN = args.includes("--dry-run");

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(level, message) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, message }));
}

function fail(message) {
  log("ERROR", message);
  process.exit(1);
}

function checkEnv() {
  if (!DATABASE_URL) fail("DATABASE_URL is not set. Cannot run backup.");
  if (!BACKUP_STORAGE_PATH) fail("BACKUP_STORAGE_PATH is not set.");
  if (DO_RESTORE && !RESTORE_DATABASE_URL) {
    fail("--restore requires RESTORE_DATABASE_URL to be set.");
  }
  log("INFO", "Environment check passed.");
}

function ensureStorageDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log("INFO", `Created backup storage directory: ${dir}`);
  }
}

function generateFilename() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  return `medicore_${ts}.sql.gz`;
}

// ── Step 1: Dump ──────────────────────────────────────────────────────────────

function runDump(outPath) {
  log("INFO", `Starting pg_dump to ${outPath}`);
  const result = spawnSync(
    "pg_dump",
    [
      "--no-password",
      "--format=plain",
      "--no-owner",
      "--no-acl",
      "--compress=9",
      `--file=${outPath}`,
      DATABASE_URL,
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 5 * 60 * 1000 }
  );

  if (result.status !== 0) {
    fail(`pg_dump failed (exit ${result.status}): ${result.stderr?.toString()}`);
  }
  log("INFO", "pg_dump completed.");
}

// ── Step 2: File integrity check ──────────────────────────────────────────────

function verifyFileIntegrity(filePath) {
  if (!existsSync(filePath)) fail(`Backup file does not exist: ${filePath}`);

  const stat = statSync(filePath);
  if (stat.size < 1024) {
    fail(`Backup file is suspiciously small (${stat.size} bytes) — may be empty or corrupt.`);
  }
  log("INFO", `Backup file size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

  // Verify gzip magic bytes (0x1f 0x8b)
  const buf = Buffer.alloc(2);
  const fd = require("fs").openSync(filePath, "r");
  require("fs").readSync(fd, buf, 0, 2, 0);
  require("fs").closeSync(fd);
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
    fail(`Backup file does not have a valid gzip header — file may be corrupt.`);
  }
  log("INFO", "Gzip header verified.");
}

// ── Step 3: SQL content check ─────────────────────────────────────────────────

async function verifySQLContent(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = createReadStream(filePath).pipe(createGunzip());
    stream.on("data", chunk => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 4096) stream.destroy(); // read first 4KB only
    });
    stream.on("close", () => {
      const header = Buffer.concat(chunks).toString("utf8", 0, 2048);
      if (!header.includes("PostgreSQL database dump")) {
        reject(new Error("Backup does not appear to be a valid pg_dump output."));
        return;
      }
      log("INFO", "SQL content check passed — valid pg_dump header found.");
      resolve();
    });
    stream.on("error", err => {
      // Stream destroyed intentionally after first 4KB — that's fine
      if (err.code === "ERR_STREAM_DESTROYED") {
        const header = Buffer.concat(chunks).toString("utf8", 0, 2048);
        if (!header.includes("PostgreSQL database dump")) {
          reject(new Error("Backup does not appear to be a valid pg_dump output."));
          return;
        }
        log("INFO", "SQL content check passed — valid pg_dump header found.");
        resolve();
        return;
      }
      reject(err);
    });
  });
}

// ── Step 4: Optional restore test ─────────────────────────────────────────────

function runRestoreTest(filePath) {
  log("INFO", `Starting restore test to ${RESTORE_DATABASE_URL}`);
  const result = spawnSync(
    "bash",
    ["-c", `zcat "${filePath}" | psql "${RESTORE_DATABASE_URL}" --no-password`],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60 * 1000 }
  );
  if (result.status !== 0) {
    fail(`Restore test failed (exit ${result.status}): ${result.stderr?.toString()}`);
  }
  log("INFO", "Restore test completed successfully.");

  // Run a basic row count check on the restored DB
  const check = spawnSync(
    "psql",
    [RESTORE_DATABASE_URL, "--no-password", "-c", "SELECT COUNT(*) FROM patients;", "--tuples-only"],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }
  );
  if (check.status !== 0) {
    fail(`Post-restore row-count check failed: ${check.stderr?.toString()}`);
  }
  const count = parseInt(check.stdout?.toString().trim(), 10);
  if (isNaN(count) || count < 0) {
    fail("Post-restore sanity check returned unexpected result.");
  }
  log("INFO", `Post-restore sanity check passed — patients table has ${count} rows.`);
}

// ── Step 5: Retention cleanup ─────────────────────────────────────────────────

function cleanupOldBackups(dir) {
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = readdirSync(dir)
    .filter(f => f.startsWith("medicore_") && f.endsWith(".sql.gz"))
    .map(f => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);

  const toDelete = files.filter(f => f.mtime < cutoff);
  for (const f of toDelete) {
    unlinkSync(f.path);
    log("INFO", `Deleted old backup: ${f.name}`);
  }
  log("INFO", `Retention cleanup: removed ${toDelete.length} old backup(s). ${files.length - toDelete.length} backup(s) retained.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("INFO", `MediCore Backup Verification started. dry-run=${DRY_RUN} restore=${DO_RESTORE}`);

  checkEnv();
  if (DRY_RUN) { log("INFO", "Dry-run mode — exiting after env check."); process.exit(0); }

  const storageDir = resolve(BACKUP_STORAGE_PATH);
  ensureStorageDir(storageDir);

  const filename = generateFilename();
  const outPath = join(storageDir, filename);

  runDump(outPath);
  verifyFileIntegrity(outPath);
  await verifySQLContent(outPath);

  if (DO_RESTORE) {
    runRestoreTest(outPath);
  }

  cleanupOldBackups(storageDir);

  log("INFO", `Backup verification SUCCESS. File: ${filename}`);
  process.exit(0);
}

main().catch(err => {
  log("ERROR", `Unhandled error: ${err.message}`);
  process.exit(1);
});
