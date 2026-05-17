import type { Request, Response, NextFunction, RequestHandler } from "express";
import { NotFoundError, ForbiddenError, ConflictError, ValidationError, UnauthorizedError } from "../services/errors";

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async route handler and maps domain errors to HTTP status codes.
 * Unrecognized errors are forwarded to the Express error handler via next().
 */
export function asyncHandler(fn: AsyncFn): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch((err: unknown) => {
      if (
        err instanceof NotFoundError ||
        err instanceof ForbiddenError ||
        err instanceof ConflictError ||
        err instanceof ValidationError ||
        err instanceof UnauthorizedError
      ) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    });
  };
}
