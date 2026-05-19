/**
 * envelope.integration.test.ts
 *
 * Verifies the canonical error envelope shape across the four ways an error can
 * reach the client:
 *   1. 404 from an unmatched route (notFoundHandler)
 *   2. Domain ValidationError from a service (asyncHandler)
 *   3. Postgres unique-violation error 23505 (globalErrorHandler)
 *   4. Unrecognized error bubbling up (globalErrorHandler → 500)
 *
 * Envelope shape (all 7 fields required):
 *   { success: false, error_code, error_name, session_state, message,
 *     request_id, timestamp }
 *
 * Tests use a minimal Express app with the exported handlers — no DB, no auth,
 * no routes. That's deliberate: we're testing the envelope contract itself,
 * not the full middleware stack (auth-flow.integration.test.ts covers that).
 */

import { describe, it, expect } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";

import { notFoundHandler, globalErrorHandler } from "../middlewares/envelope";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { E } from "../errors";
import { correlationId } from "../middlewares/correlationId";

function buildTestApp() {
  const app = express();
  app.use(correlationId); // assigns req.id so request_id is non-empty

  // Route that throws ValidationError from inside a service-like async function.
  // asyncHandler must catch it and emit the canonical envelope.
  app.get(
    "/throws/validation",
    asyncHandler(async () => {
      throw new ValidationError("patientId is required");
    }),
  );

  // Route that throws a Postgres unique-violation-shaped error. asyncHandler
  // forwards non-domain errors via next(), so globalErrorHandler sees it.
  app.get("/throws/unique", (_req: Request, _res: Response, next) => {
    const err = new Error("duplicate key value violates unique constraint") as Error & { code?: string };
    err.code = "23505";
    next(err);
  });

  // Route that throws a generic unexpected error. Same forwarding path.
  app.get("/throws/generic", (_req: Request, _res: Response, next) => {
    next(new Error("kaboom"));
  });

  // Order matters: 404 must come after all routes; error handler last (4 params).
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

function expectEnvelope(body: unknown, def: typeof E[keyof typeof E]) {
  expect(body).toMatchObject({
    success: false,
    error_code: def.code,
    error_name: def.name,
    session_state: expect.stringMatching(/^(authenticated|unauthenticated)$/),
    message: expect.any(String),
    request_id: expect.anything(), // string | number from correlationId
    timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
  });
}

describe("canonical error envelope", () => {
  it("unknown route → 404 with DOMAIN_NOT_FOUND envelope", async () => {
    const res = await request(buildTestApp()).get("/no/such/route");
    expect(res.status).toBe(E.DOMAIN_NOT_FOUND.status);
    expectEnvelope(res.body, E.DOMAIN_NOT_FOUND);
    expect(res.body.message).toMatch(/route not found/i);
  });

  it("ValidationError from a service → 400 with DOMAIN_VALIDATION envelope", async () => {
    const res = await request(buildTestApp()).get("/throws/validation");
    expect(res.status).toBe(E.DOMAIN_VALIDATION.status);
    expectEnvelope(res.body, E.DOMAIN_VALIDATION);
    expect(res.body.message).toBe("patientId is required");
  });

  it("Postgres 23505 unique violation → 409 with DOMAIN_CONFLICT envelope", async () => {
    const res = await request(buildTestApp()).get("/throws/unique");
    expect(res.status).toBe(E.DOMAIN_CONFLICT.status);
    expectEnvelope(res.body, E.DOMAIN_CONFLICT);
    expect(res.body.message).toMatch(/duplicate/i);
  });

  it("unrecognized error → 500 with INFRA_INTERNAL envelope and no stack in body", async () => {
    const res = await request(buildTestApp()).get("/throws/generic");
    expect(res.status).toBe(E.INFRA_INTERNAL.status);
    expectEnvelope(res.body, E.INFRA_INTERNAL);
    // NODE_ENV is "test" (vitest default), not "development" — should NOT leak err.message
    expect(res.body.message).toBe("Internal server error");
    expect(JSON.stringify(res.body)).not.toMatch(/kaboom/);
    expect(JSON.stringify(res.body)).not.toMatch(/\.ts:/); // no stack trace fragments
  });
});
