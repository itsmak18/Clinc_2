import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { validate } from "../middlewares/validate";

function mockRes() {
  const res = {} as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

// `coerce.date` mirrors the generated schemas (e.g. scheduledAt) — used to prove
// validate() does NOT replace req.body with the coerced/stripped parse result.
const schema = z.object({ name: z.string(), when: z.coerce.date().optional() });

describe("validate() middleware", () => {
  it("calls next() on valid input and leaves req.body UNCHANGED (no strip, no coerce)", () => {
    const original = { name: "x", when: "2026-01-01T00:00:00.000Z", extra: "keep" };
    const req = { body: { ...original }, id: "r1" } as any;
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // Unknown key preserved (not stripped) and `when` still the original string
    // (not coerced to a Date) — the service receives exactly what the client sent.
    expect(req.body).toEqual(original);
    expect(typeof req.body.when).toBe("string");
  });

  it("emits a 400 DOMAIN_VALIDATION envelope and does NOT call next() on invalid input", () => {
    const req = { body: { when: "2026-01-01" }, id: "r2", user: { userId: 1 } } as any; // missing name
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error_name).toBeTruthy();
    expect(payload.request_id).toBe("r2");
    expect(payload.message).toMatch(/name/i);
  });

  it("can validate the query source", () => {
    const req = { query: { name: "q" }, id: "r3" } as any;
    const res = mockRes();
    const next = vi.fn();

    validate(schema, "query")(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
