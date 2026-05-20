/**
 * customFetch.csrf.test.ts
 *
 * Behavioral pinning for the CSRF double-submit attachment in the frontend
 * customFetch mutator. We do NOT import the source file (it lives in
 * `lib/api-client-react` which sits outside api-server's `rootDir` and is
 * DOM-typed). Instead we re-implement the exact attachment logic the source
 * file uses, and pin it. If you change the algorithm in custom-fetch.ts, update
 * `attachCsrfHeader` below to match — drift will manifest as a real CSRF bug
 * in production (the same shape as the 2026-05-13 logout regression).
 *
 * Source under test:
 *   lib/api-client-react/src/custom-fetch.ts:363-374
 *     const MUTATION_METHODS = new Set(["POST","PUT","PATCH","DELETE"]);
 *     if (MUTATION_METHODS.has(method) && typeof document !== "undefined") {
 *       const csrfCookie = document.cookie
 *         .split("; ")
 *         .find(row => row.startsWith("_csrf="));
 *       if (csrfCookie) headers.set("X-CSRF-Token", csrfCookie.split("=")[1]);
 *     }
 */
import { describe, it, expect } from "vitest";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function attachCsrfHeader(method: string, cookieJar: string): Headers {
  const headers = new Headers();
  if (MUTATION_METHODS.has(method)) {
    const csrfCookie = cookieJar
      .split("; ")
      .find(row => row.startsWith("_csrf="));
    if (csrfCookie) headers.set("X-CSRF-Token", csrfCookie.split("=")[1]);
  }
  return headers;
}

describe("customFetch CSRF attachment contract", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s requests pick up the _csrf cookie value",
    (method) => {
      const h = attachCsrfHeader(method, "session=foo; _csrf=tok-abc-123; theme=dark");
      expect(h.get("X-CSRF-Token")).toBe("tok-abc-123");
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"] as const)(
    "%s requests do NOT attach X-CSRF-Token",
    (method) => {
      const h = attachCsrfHeader(method, "_csrf=tok-abc-123");
      expect(h.get("X-CSRF-Token")).toBeNull();
    },
  );

  it("does not attach when the _csrf cookie is missing", () => {
    const h = attachCsrfHeader("POST", "session=foo; theme=dark");
    expect(h.get("X-CSRF-Token")).toBeNull();
  });

  it("does not attach when the cookie jar is empty", () => {
    const h = attachCsrfHeader("POST", "");
    expect(h.get("X-CSRF-Token")).toBeNull();
  });

  it("ignores cookies whose name only contains _csrf as a substring", () => {
    // `not_csrf=` and `x_csrf_foo=` must not satisfy startsWith("_csrf=").
    const h = attachCsrfHeader("POST", "not_csrf=nope; x_csrf_foo=nope");
    expect(h.get("X-CSRF-Token")).toBeNull();
  });
});
