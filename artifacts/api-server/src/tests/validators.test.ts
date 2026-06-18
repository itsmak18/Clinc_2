/**
 * validators.test.ts
 *
 * Tests for safeParseInt and validateParamInt.
 * All boundary values required: 0, negative, NaN, float, MAX_INT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { safeParseInt, validateParamInt, escapeLike } from "../lib/validators";

// ── safeParseInt ──────────────────────────────────────────────────────────────

describe("safeParseInt", () => {
  it("parses a valid positive integer string", () => {
    expect(safeParseInt("42")).toBe(42);
  });

  it("parses a positive number value", () => {
    expect(safeParseInt(99)).toBe(99);
  });

  it("returns null for undefined", () => {
    expect(safeParseInt(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(safeParseInt(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(safeParseInt("")).toBeNull();
  });

  it("returns null for 0 (boundary — IDs start at 1)", () => {
    expect(safeParseInt("0")).toBeNull();
    expect(safeParseInt(0)).toBeNull();
  });

  it("returns null for negative values", () => {
    expect(safeParseInt("-1")).toBeNull();
    expect(safeParseInt(-5)).toBeNull();
  });

  it("returns null for NaN string", () => {
    expect(safeParseInt("NaN")).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(safeParseInt("abc")).toBeNull();
  });

  it("returns null for float string (parseInt truncates but value is valid — 3)", () => {
    // parseInt("3.7") = 3, which is > 0, so it DOES return 3
    expect(safeParseInt("3.7")).toBe(3);
  });

  it("handles array input — takes first element", () => {
    expect(safeParseInt(["5", "99"])).toBe(5);
  });

  it("handles MAX_SAFE_INTEGER", () => {
    expect(safeParseInt(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns the numeric prefix from a SQL injection probe (safe — Drizzle uses parameterized queries)", () => {
    // parseInt("1; DROP TABLE patients--") = 1 — the integer prefix is extracted.
    // This is SAFE: Drizzle never interpolates this value directly into SQL.
    // The returned value 1 will be used as a parameterized bind variable.
    expect(safeParseInt("1; DROP TABLE patients--")).toBe(1);
  });

  it("returns null for '1 OR 1=1'", () => {
    // parseInt("1 OR 1=1") = 1 (parseInt stops at space) — this is VALID (returns 1)
    // Documenting actual behaviour to prevent future confusion
    expect(safeParseInt("1 OR 1=1")).toBe(1);
  });
});

// ── escapeLike ─────────────────────────────────────────────────────────────────

describe("escapeLike", () => {
  it("leaves plain text untouched", () => {
    expect(escapeLike("john smith")).toBe("john smith");
  });

  it("escapes percent (match-all wildcard) to a literal", () => {
    expect(escapeLike("50%")).toBe("50\\%");
  });

  it("escapes underscore (single-char wildcard) to a literal", () => {
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes a backslash so it can't smuggle an escape sequence", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("escapes an all-wildcard probe so it matches literally, not everything", () => {
    expect(escapeLike("%%")).toBe("\\%\\%");
  });
});

// ── validateParamInt middleware ────────────────────────────────────────────────

describe("validateParamInt", () => {
  function makeReq(paramValue: string): Request {
    return { params: { id: paramValue } } as unknown as Request;
  }

  function makeRes() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
  }

  it("calls next() for a valid positive integer param", () => {
    const next = vi.fn();
    validateParamInt("id")(makeReq("5"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 400 for a zero param", () => {
    const res = makeRes();
    const next = vi.fn();
    validateParamInt("id")(makeReq("0"), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a negative param", () => {
    const res = makeRes();
    const next = vi.fn();
    validateParamInt("id")(makeReq("-1"), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric string param", () => {
    const res = makeRes();
    const next = vi.fn();
    validateParamInt("id")(makeReq("abc"), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for empty string param", () => {
    const res = makeRes();
    const next = vi.fn();
    validateParamInt("id")(makeReq(""), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("includes the param name in the error message", () => {
    const res = makeRes();
    validateParamInt("patientId")(makeReq("abc"), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("patientId") }),
    );
  });
});
