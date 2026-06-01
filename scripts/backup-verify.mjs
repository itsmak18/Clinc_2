#!/usr/bin/env node
/**
 * backup-verify.mjs
 *
 * Weekly backup verification script for MediCore PostgreSQL database.
 *
 * What it does:
 *   1. Dumps the production DB to a timestamped .sql.gz file
 *   2. (Prod) Encrypts the dump with GPG → .sql.gz.gpg
 *   3. Verifies the file is non-empty and has the expected magic bytes
 *   4. Parses the (decrypted) SQL header to confirm it is a real pg_dump output
 *   5. (Optional, --restore) Restores to an ephemeral DB URL, proving decryption
 *      works end-to-end — not just that the file decrypts but that psql replays it
 *   6. (Optional) Uploads to a named offsite destination via $OFFSITE_UPLOAD_COMMAND
 *   7. Prunes backups older than $BACKUP_RETENTION_DAYS
 *
 * Usage:
 *   node scripts/backup-verify.mjs                      # weekly backup + verify
 *   node scripts/backup-verify.mjs --restore            # quarterly restore drill
 *   node scripts/backup-verify.mjs --dry-run            # verify env only
 *
 * Required env vars:
 *   DATABASE_URL          — source (production) PostgreSQL connection string
 *   BACKUP_STORAGE_PATH   — local or mounted path to write backup files
 *
 * Required in production:
 *   BACKUP_GPG_RECIPIENT  — GPG key ID or email of the backup encryption key.
 *                           When set, backups are encrypted with this recipient's
 *                           public key. See docs/BACKUP_KEY_MANAGEMENT.md.
 *
 * Optional env vars:
 *   RESTORE_DATABASE_URL  — ephemeral DB for restore drill (--restore mode)
 *   BACKUP_RETENTION_DAYS — how many backups to keep locally (default: 30)
 *   OFFSITE_UPLOAD_COMMAND — shell command run after successful verify to push
 *                            the file offsite. The token {FILE} is substituted
 *                            with the local file path. Examples:
 *                              "rclone copy {FILE} backblaze:medicore-backups/"
 *                              "aws s3 cp {FILE} s3://medicore-backups/"
 *
 * Exit codes:
 *   0 — backup (and restore drill, if requested) verified successfully
 *   1 — any step failed (dump, encrypt, verify, restore, upload)
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
const BACKUP_GPG_RECIPIENT = process.env.BACKUP_GPG_RECIPIENT;
const OFFSITE_UPLOAD_COMMAND = process.env.OFFSITE_UPLOAD_COMMAND;
const IS_PROD = process.env.NODE_ENV === "production";

const args = process.argv.slice(2);
const DO_RESTORE = args.includes("--restore");
const DRY_RUN = args.includes("--dry-run");
const ENCRYPT = Boolean(BACKUP_GPG_RECIPIENT);

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
  if (IS_PROD && !ENCRYPT) {
    fail(
      "BACKUP_GPG_RECIPIENT is not set. Unencrypted backups are not permitted in production. " +
      "See docs/BACKUP_KEY_MANAGEMENT.md."
    );
  }
  if (ENCRYPT) {
    const which = spawnSync("gpg", ["--version"], { stdio: "ignore" });
    if (which.status !== 0) fail("gpg is required for encrypted backups but is not on PATH.");
  }
  log("INFO", `Environment check passed. encrypt=${ENCRYPT} restore=${DO_RESTORE}`);
}

function ensureStorageDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log("INFO", `Created backup storage directory: ${dir}`);
  }
}

function generateFilename() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  return ENCRYPT ? `medicore_${ts}.sql.gz.gpg` : `medicore_${ts}.sql.gz`;
}

// ── Step 1: Dump ──────────────────────────────────────────────────────────────

function runDump(outPath) {
  if (ENCRYPT) {
    log("INFO", `Starting pg_dump | gpg --encrypt → ${outPath}`);
    // Pipeline: pg_dump (plain SQL on stdout) | gpg --encrypt --output file.sql.gz.gpg
    // pg_dump's --compress=9 already gzip-compresses on stdout, so the GPG output
    // wraps a gzipped SQL stream. The .sql.gz.gpg suffix reflects that exactly.
    const result = spawnSync(
      "sh",
      [
        "-c",
        `pg_dump --no-password --format=plain --no-owner --no-acl --compress=9 ` +
          `"${DATABASE_URL}" | ` +
          `gpg --batch --yes --trust-model always --encrypt ` +
          `--recipient "${BACKUP_GPG_RECIPIENT}" --output "${outPath}"`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60 * 1000 }
    );
    if (result.status !== 0) {
      fail(`pg_dump | gpg pipeline failed (exit ${result.status}): ${result.stderr?.toString()}`);
    }
    log("INFO", "pg_dump + gpg encryption completed.");
    return;
  }

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

  // Read first 2 bytes (sync, then close)
  const fs = require("fs");
  const buf = Buffer.alloc(2);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);

  if (ENCRYPT) {
    // GPG binary packets start with a packet tag byte. Old format: 0x84-0xC9.
    // New format (RFC 4880): 0xC0-0xFF. We accept either common form.
    // The PUBLIC-KEY ENCRYPTED SESSION KEY packet tag is most common — 0x85 (old) or 0xC1 (new).
    const first = buf[0];
    const looksLikeGpgBinary = first === 0x85 || first === 0x84 || first === 0xc1 || first === 0xc3;
    // ASCII-armored ("-----BEGIN PGP MESSAGE-----") starts with '-' (0x2d)
    const looksLikeGpgArmor = first === 0x2d;
    if (!looksLikeGpgBinary && !looksLikeGpgArmor) {
      fail(`Encrypted backup file does not start with a recognized GPG packet (got 0x${first.toString(16)}).`);
    }
    log("INFO", "GPG header verified.");
  } else {
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
      fail(`Backup file does not have a valid gzip header — file may be corrupt.`);
    }
    log("INFO", "Gzip header verified.");
  }
}

// ── Step 3: SQL content check ─────────────────────────────────────────────────

async function verifySQLContent(filePath) {
  // When encrypted, we shell out to `gpg --decrypt | gunzip` and inspect the
  // first 4 KB. This is the cheap proof that decryption works locally —
  // independent of the full restore-drill (which proves psql replays it).
  if (ENCRYPT) {
    const result = spawnSync(
      "sh",
      ["-c", `gpg --batch --yes --decrypt "${filePath}" 2>/dev/null | gunzip -c | head -c 4096`],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }
    );
    if (result.status !== 0) {
      throw new Error(
        `Encrypted backup failed to decrypt locally (exit ${result.status}). ` +
        `Either GPG private key is missing on this host or the file is corrupt. stderr=${result.stderr?.toString()}`
      );
    }
    const header = result.stdout.toString("utf8", 0, 2048);
    if (!header.includes("PostgreSQL database dump")) {
      throw new Error("Decrypted backup does not appear to be a valid pg_dump output.");
    }
    log("INFO", "Decryption + SQL content check passed.");
    return;
  }

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
  // Pipeline proves the full restore chain end-to-end:
  //   (encrypted)   gpg --decrypt | gunzip | psql
  //   (plaintext)   gunzip        | psql
  // Failure anywhere in the pipe — missing GPG key, corrupt cipher, replay
  // syntax error — bubbles up as a non-zero exit and trips fail().
  const pipeline = ENCRYPT
    ? `gpg --batch --yes --decrypt "${filePath}" | gunzip -c | psql "${RESTORE_DATABASE_URL}" --no-password -v ON_ERROR_STOP=1`
    : `zcat "${filePath}" | psql "${RESTORE_DATABASE_URL}" --no-password -v ON_ERROR_STOP=1`;

  log("INFO", `Starting restore drill (encrypt=${ENCRYPT}) to ${RESTORE_DATABASE_URL}`);
  const result = spawnSync(
    "sh",
    ["-c", `set -o pipefail; ${pipeline}`],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60 * 1000 }
  );
  if (result.status !== 0) {
    fail(`Restore drill failed (exit ${result.status}): ${result.stderr?.toString()}`);
  }
  log("INFO", "Restore drill replayed successfully.");

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

// ── Step 4b: Erasure blackout check ──────────────────────────────────────────
//
// After restoring a backup, any patient whose erasure was executed while the
// backup was still within its retention window will have their pre-erasure PHI
// revived. The erasure_blackout_until column records this window. Re-apply
// anonymization for all rows where status='executed' AND now() is before
// erasure_blackout_until.
//
// This function FAILS the restore drill if active blackouts exist, so the
// operator cannot accidentally mark a tainted restore as "verified."
//
// In production, after a real emergency restore, the operator should:
//   1. Identify all active blackout rows (the query below).
//   2. Re-execute the anonymization for each patient (see RUNBOOK §2.2).
//   3. Only then promote the restored DB to production.

function checkErasureBlackouts() {
  if (!RESTORE_DATABASE_URL) return; // should not reach here, but guard anyway
  log("INFO", "Checking for active erasure blackouts in the restored database...");

  const query = `
    SELECT id, patient_id, executed_at, erasure_blackout_until
    FROM erasure_requests
    WHERE status = 'executed'
      AND erasure_blackout_until IS NOT NULL
      AND erasure_blackout_until > now()
    ORDER BY executed_at DESC;
  `;

  const result = spawnSync(
    "psql",
    [RESTORE_DATABASE_URL, "--no-password", "-c", query, "--tuples-only", "--no-align", "--field-separator=|"],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }
  );

  if (result.status !== 0) {
    fail(`Erasure blackout check failed: ${result.stderr?.toString()}`);
  }

  const rows = result.stdout?.toString().trim().split("\n").filter(Boolean) ?? [];
  if (rows.length === 0) {
    log("INFO", "No active erasure blackouts — restored data is clean.");
    return;
  }

  log("ERROR", `ERASURE BLACKOUT VIOLATION: ${rows.length} patient(s) had their PHI erased but this backup was produced BEFORE the erasure blackout window expired.`);
  log("ERROR", "The restored database contains pre-erasure PHI for the following erasure request IDs:");
  for (const row of rows) {
    const [id, patientId, executedAt, blackoutUntil] = row.split("|");
    log("ERROR", `  erasure_request.id=${id?.trim()} patient_id=${patientId?.trim()} executed_at=${executedAt?.trim()} blackout_until=${blackoutUntil?.trim()}`);
  }
  log("ERROR", "ACTION REQUIRED: Re-apply anonymization before promoting this restore to production. See RUNBOOK §2.2 — Erasure Re-Application.");
  fail(`Restore drill aborted: ${rows.length} active erasure blackout(s) detected. See above for affected patients.`);
}

// ── Step 4c: Audit integrity check post-restore ───────────────────────────────
//
// After restoring a backup, verify that the audit_integrity_checks table has no
// recorded mismatches. A mismatch means the hash chain was broken before the
// backup was taken — a signal of possible tampering or data corruption that the
// operator must investigate before promoting the restore to production.
//
// This does NOT re-compute hashes from scratch (that requires calling
// verifyIntegrity() from lib/audit-integrity.ts). Instead it checks whether any
// stored integrity records are in the 'mismatch' status — a lighter SQL-only
// check that is appropriate in the restore-drill context.

function checkAuditIntegrity() {
  if (!RESTORE_DATABASE_URL) return;
  log("INFO", "Checking audit_integrity_checks for recorded mismatches in restored database...");

  // Check for any stored mismatch status rows.
  const mismatchResult = spawnSync(
    "psql",
    [
      RESTORE_DATABASE_URL,
      "--no-password",
      "--tuples-only",
      "--no-align",
      "-c",
      "SELECT COUNT(*)::int FROM audit_integrity_checks WHERE status = 'mismatch';",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }
  );
  if (mismatchResult.status !== 0) {
    fail(`Audit integrity query failed: ${mismatchResult.stderr?.toString()}`);
  }
  const mismatches = parseInt(mismatchResult.stdout?.toString().trim(), 10);
  if (isNaN(mismatches)) {
    // Table doesn't exist yet (pre-migration 0010 restore) — skip silently.
    log("WARN", "audit_integrity_checks table not found in restored DB — integrity check skipped.");
    return;
  }
  if (mismatches > 0) {
    fail(
      `Restore drill: ${mismatches} audit_integrity_checks row(s) have status='mismatch'. ` +
      "The hash chain was broken before this backup was taken. Investigate before promoting."
    );
  }

  // Also report how many OK/empty records exist as a sanity signal.
  const okResult = spawnSync(
    "psql",
    [
      RESTORE_DATABASE_URL,
      "--no-password",
      "--tuples-only",
      "--no-align",
      "-c",
      "SELECT COUNT(*)::int FROM audit_integrity_checks WHERE status IN ('ok', 'empty');",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }
  );
  const okCount = parseInt(okResult.stdout?.toString().trim(), 10);
  log("INFO", `Post-restore audit integrity: ${okCount} checked date(s) verified OK, 0 mismatches.`);
}

// ── Step 4e: Offsite upload ───────────────────────────────────────────────────

function runOffsiteUpload(filePath) {
  if (!OFFSITE_UPLOAD_COMMAND) {
    log("WARN", "OFFSITE_UPLOAD_COMMAND not set — backup remains on local disk only.");
    return;
  }
  const cmd = OFFSITE_UPLOAD_COMMAND.includes("{FILE}")
    ? OFFSITE_UPLOAD_COMMAND.replaceAll("{FILE}", filePath)
    : `${OFFSITE_UPLOAD_COMMAND} ${filePath}`;
  log("INFO", `Uploading offsite: ${cmd}`);
  const result = spawnSync("sh", ["-c", cmd], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30 * 60 * 1000,
  });
  if (result.status !== 0) {
    fail(`Offsite upload failed (exit ${result.status}): ${result.stderr?.toString()}`);
  }
  log("INFO", "Offsite upload completed.");
}

// ── Step 5: Retention cleanup ─────────────────────────────────────────────────

function cleanupOldBackups(dir) {
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = readdirSync(dir)
    .filter(f => f.startsWith("medicore_") && (f.endsWith(".sql.gz") || f.endsWith(".sql.gz.gpg")))
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
    checkErasureBlackouts();
    checkAuditIntegrity();
  }

  runOffsiteUpload(outPath);

  cleanupOldBackups(storageDir);

  log("INFO", `Backup verification SUCCESS. File: ${filename}`);
  process.exit(0);
}

main().catch(err => {
  log("ERROR", `Unhandled error: ${err.message}`);
  process.exit(1);
});
