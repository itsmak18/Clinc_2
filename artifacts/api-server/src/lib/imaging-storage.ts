/**
 * imaging-storage.ts — on-disk store for X-ray / ultrasound image files.
 *
 * Files are written to IMAGING_STORAGE_DIR (default ./storage/imaging in dev; a
 * mounted Docker volume in prod). Layout: {root}/{clinicId}/{modality}/{uuid}.enc
 * — clinic-scoped directories with opaque uuid filenames (no PHI in the path).
 * Bytes on disk are AES-256-GCM ciphertext (see field-encryption.encryptBuffer);
 * this module is storage-only and does not encrypt — the service encrypts first.
 *
 * The download endpoint is the ONLY sanctioned reader (auth + scope + audit) —
 * the directory is never served via express.static.
 */
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { config } from "./config";

export type Modality = "xray" | "ultrasound";

const DEFAULT_DIR = path.resolve(process.cwd(), "storage", "imaging");

export function storageRoot(): string {
  const fromEnv = config.imagingStorageDir?.trim();
  return fromEnv ? path.resolve(fromEnv) : DEFAULT_DIR;
}

/** Relative key persisted on the row, e.g. "1/xray/4f9c…e2.enc". POSIX separators. */
export function newStorageKey(clinicId: number, modality: Modality): string {
  return `${clinicId}/${modality}/${randomUUID()}.enc`;
}

function absPath(storageKey: string): string {
  const root = storageRoot();
  // Resolve and confirm the result stays under the root — defense against any
  // future caller passing a key with traversal segments.
  const resolved = path.resolve(root, storageKey);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error("Refusing to access path outside the imaging storage root");
  }
  return resolved;
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function writeImageFile(storageKey: string, bytes: Buffer): Promise<void> {
  const dest = absPath(storageKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes, { mode: 0o600 });
}

export async function readImageFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(absPath(storageKey));
}

/** Best-effort unlink — a missing file (already gone) is not an error. */
export async function deleteImageFile(storageKey: string): Promise<void> {
  try {
    await fs.unlink(absPath(storageKey));
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}

export interface StoredFile {
  /** Relative POSIX storageKey, e.g. "1/xray/4f9c…e2.enc" — matches the DB column. */
  storageKey: string;
  /** Last-modified epoch ms — used by the orphan reconciler's grace window. */
  mtimeMs: number;
}

/**
 * Recursively enumerate every `*.enc` file under the storage root as relative
 * POSIX storageKeys (matching the DB `storage_key` column) with their mtime.
 * Returns `[]` when the root doesn't exist yet. Only `.enc` files are reported,
 * so a misconfigured root can never sweep unrelated files. Storage-only — the
 * orphan reconciler in imaging-attachments.service joins this against the DB.
 */
export async function listStoredFiles(): Promise<StoredFile[]> {
  const root = storageRoot();
  const out: StoredFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err?.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".enc")) continue;
      const storageKey = path.relative(root, abs).split(path.sep).join("/");
      const stat = await fs.stat(abs);
      out.push({ storageKey, mtimeMs: stat.mtimeMs });
    }
  }
  await walk(root);
  return out;
}
