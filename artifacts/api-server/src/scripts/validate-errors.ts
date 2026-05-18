/**
 * validate-errors.ts
 *
 * CI guard: every numeric `error_code` literal emitted by route/service/middleware/lib
 * code MUST exist in the canonical `E` map in `src/errors.ts`. Catches orphan
 * codes introduced by hand-rolled error responses bypassing the kernel envelope.
 *
 * Run via: pnpm --filter @workspace/api-server run validate:errors
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { E } from "../errors";

const registered = new Set(Object.values(E).map(e => e.code));

const ROOT = "src";
const SCAN_DIRS = ["routes", "services", "middlewares", "lib"];
const CODE_RE = /error_code[^0-9]{1,10}(\d{4})/g;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(p) === ".ts" && !p.endsWith(".d.ts")) out.push(p);
  }
}

const files: string[] = [];
for (const sub of SCAN_DIRS) {
  try { walk(join(ROOT, sub), files); } catch { /* dir missing — skip */ }
}

const orphans: Array<{ file: string; code: number }> = [];
for (const file of files) {
  const src = readFileSync(file, "utf-8");
  for (const m of src.matchAll(CODE_RE)) {
    const code = Number(m[1]);
    if (!registered.has(code)) orphans.push({ file, code });
  }
}

if (orphans.length) {
  console.error("Orphan error codes (not registered in src/errors.ts):");
  for (const o of orphans) console.error(`  ${o.file}: ${o.code}`);
  process.exit(1);
}
console.log(`OK — ${registered.size} codes registered, no orphans found across ${files.length} files.`);
