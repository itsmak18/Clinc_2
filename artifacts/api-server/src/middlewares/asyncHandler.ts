import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ClearanceRequiredError,
  ClearanceGateDisabledError,
} from "../services/errors";
import type { ErrorDef } from "../errors";

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

type DomainError = (NotFoundError | ForbiddenError | ConflictError | ValidationError | UnauthorizedError | ClearanceRequiredError | ClearanceGateDisabledError) & {
  errorDef: ErrorDef;
};

function isDomainError(err: unknown): err is DomainError {
  return (
    err instanceof NotFoundError ||
    err instanceof ForbiddenError ||
    err instanceof ConflictError ||
    err instanceof ValidationError ||
    err instanceof UnauthorizedError ||
    err instanceof ClearanceRequiredError ||
    err instanceof ClearanceGateDisabledError
  );
}

/**
 * Wraps an async route handler and maps domain errors to HTTP status codes
 * using the canonical error envelope (success, error_code, error_name,
 * session_state, message, request_id, timestamp). Unrecognized errors are
 * forwarded to the Express error handler via next().
 */
export function asyncHandler(fn: AsyncFn): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch((err: unknown) => {
      if (isDomainError(err)) {
        const def = err.errorDef;
        res.status(def.status).json({
          success: false,
          error_code: def.code,
          error_name: def.name,
          session_state: "authenticated",
          message: err.message,
          request_id: req.id,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(err);
    });
  };
}
