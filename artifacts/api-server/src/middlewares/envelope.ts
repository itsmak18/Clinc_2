import type { Request, RequestHandler, ErrorRequestHandler } from "express";
import { logger } from "../lib/logger";
import { E, type ErrorDef } from "../errors";

/**
 * Canonical error envelope helpers.
 *
 * Three exit paths exist for an error response:
 *   1. asyncHandler (middlewares/asyncHandler.ts) catches domain errors thrown
 *      from services and emits the envelope directly.
 *   2. notFoundHandler — for routes Express never matched.
 *   3. globalErrorHandler — for anything else (Postgres errors, thrown
 *      non-domain errors, errors forwarded via next(err)).
 *
 * All three emit the same 7-field shape so the frontend's 401 interceptor and
 * monitoring on `error_code` work uniformly.
 */

function sessionStateFor(req: Request): "authenticated" | "unauthenticated" {
  return (req as Request & { user?: unknown }).user ? "authenticated" : "unauthenticated";
}

export function buildEnvelope(req: Request, def: ErrorDef, message: string) {
  return {
    success: false as const,
    error_code: def.code,
    error_name: def.name,
    session_state: sessionStateFor(req),
    message,
    request_id: req.id,
    timestamp: new Date().toISOString(),
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(E.DOMAIN_NOT_FOUND.status).json(buildEnvelope(req, E.DOMAIN_NOT_FOUND, "Route not found"));
};

export const globalErrorHandler: ErrorRequestHandler = (err: Error, req, res, _next) => {
  logger.error({
    err: { message: err.message, stack: err.stack, name: err.name },
    method: req.method,
    url: req.url?.split("?")[0],
    userId: (req as Request & { user?: { userId?: number } }).user?.userId,
  });

  // PostgreSQL unique violation → CONFLICT envelope
  if ((err as Error & { code?: string }).code === "23505") {
    res
      .status(E.DOMAIN_CONFLICT.status)
      .json(buildEnvelope(req, E.DOMAIN_CONFLICT, "Duplicate record — this entry already exists."));
    return;
  }
  // Postgres foreign-key violation → VALIDATION envelope (referenced ID was bad input)
  if ((err as Error & { code?: string }).code === "23503") {
    res
      .status(E.DOMAIN_VALIDATION.status)
      .json(buildEnvelope(req, E.DOMAIN_VALIDATION, "Referenced record does not exist."));
    return;
  }

  // Anything else → INTERNAL. Never expose stack traces in production.
  const message =
    process.env.NODE_ENV === "development" ? err.message : "Internal server error";
  res.status(E.INFRA_INTERNAL.status).json(buildEnvelope(req, E.INFRA_INTERNAL, message));
};
