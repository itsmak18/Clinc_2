/**
 * correlationId.ts
 *
 * Generates a UUID v4 per request and attaches it to:
 * - res.locals.requestId  (for use in subsequent middleware/handlers)
 * - res header X-Request-ID (returned to client for support correlation)
 *
 * Must be mounted BEFORE pinoHttp so the logger picks up the request ID.
 */
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-ID", id);
  // Attach to req for pino-http auto-pickup via req.id
  (req as any).id = id;
  next();
}
