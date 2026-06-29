/**
 * Contract guard: every OpenAPI operation must have a matching Express route
 * + HTTP method.
 *
 * Why this exists: on 2026-06-15 the spec declared 9 update operations as `put:`
 * while every route is `router.patch(...)` (no `router.put` handlers exist). The
 * Orval-generated client therefore issued PUT, which matched no route → 404
 * "Route not found" on EVERY edit form (patients, users, appointments, medical
 * records, x-ray, lab, invoices, operations, inventory). Nothing caught it: no
 * test asserted spec-method ↔ route-method alignment, and the app is undeployed.
 *
 * This is a pure static check (no DB, no app build): it parses `paths:` from
 * openapi.yaml and `router.<method>("<path>")` from every route file, then
 * asserts every spec operation is implemented. A drift now fails CI instead of
 * reaching the UI as a 404.
 *
 * Direction: spec → route only. Routes that exist but are NOT in the spec
 * (health, jwks, SSE stream, global search, etc.) are intentional internal /
 * non-client endpoints and are reported informationally, not failed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = join(here, "../../../../lib/api-spec/openapi.yaml");
const ROUTES_DIR = join(here, "../routes");
// Feature modules declare their HTTP surface in `<module>.routes.ts` files.
const MODULES_DIR = join(here, "../modules");

const HTTP = "get|post|put|patch|delete";

interface Op { method: string; path: string; file?: string }

/** Canonical key: METHOD + path with all params collapsed to `:p`, no trailing slash. */
function norm(o: Op): string {
  const path = o.path
    .replace(/\{[^}]+\}/g, ":p") // {patientId} → :p  (OpenAPI style)
    .replace(/:[^/]+/g, ":p")    // :patientId  → :p  (Express style)
    .replace(/\/+$/, "");
  return `${o.method.toUpperCase()} ${path}`;
}

/** Operations declared under the spec's `paths:` block. */
function specOps(): Op[] {
  const lines = readFileSync(SPEC, "utf8").split(/\r?\n/);
  const ops: Op[] = [];
  let inPaths = false;
  let curPath: string | null = null;
  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) inPaths = false; // reached the next top-level section
    if (!inPaths) continue;
    const p = line.match(/^ {2}(\/\S*):\s*$/);
    if (p) { curPath = p[1]; continue; }
    const m = line.match(new RegExp(`^ {4}(${HTTP}):\\s*$`));
    if (m && curPath) ops.push({ method: m[1], path: curPath });
  }
  return ops;
}

/** Absolute paths of every file that can declare Express routes: the legacy
 *  technical-layer `routes/*.ts` plus feature-module `modules/<m>/<m>.routes.ts`. */
function routeFiles(): string[] {
  const files: string[] = [];
  for (const f of readdirSync(ROUTES_DIR).filter(f => f.endsWith(".ts"))) {
    files.push(join(ROUTES_DIR, f));
  }
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".routes.ts")) files.push(full);
    }
  };
  try { walk(MODULES_DIR); } catch { /* modules dir may not exist yet */ }
  return files;
}

/** `router.<method>("<path>", ...)` calls across every route file. */
function routeOps(): Op[] {
  const ops: Op[] = [];
  const re = new RegExp(`router\\.(${HTTP})\\s*\\(\\s*["'\`]([^"'\`]+)["'\`]`, "gs");
  for (const file of routeFiles()) {
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) ops.push({ method: m[1], path: m[2], file });
  }
  return ops;
}

describe("OpenAPI ⇄ Express route contract", () => {
  const spec = specOps();
  const routes = routeOps();
  const routeSet = new Set(routes.map(norm));

  it("parses a sane number of operations from both sides", () => {
    expect(spec.length).toBeGreaterThan(50);
    expect(routes.length).toBeGreaterThan(50);
  });

  it("every OpenAPI operation has a matching Express route + method", () => {
    const missing = spec.filter(o => !routeSet.has(norm(o))).map(norm).sort();
    expect(
      missing,
      `OpenAPI operations with no matching Express route+method (the generated ` +
        `client will call these and get 404 "Route not found"):\n  ${missing.join("\n  ")}\n`,
    ).toEqual([]);
  });
});
