import type { Request, Response, NextFunction } from "express";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Safely parse an integer from route params. Returns null if invalid.
 */
export function safeParseInt(value: any): number | null {
  if (!value) return null;
  const strValue = Array.isArray(value) ? value[0] : String(value);
  const n = parseInt(strValue, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/**
 * Middleware that validates a route param is a valid positive integer.
 */
export function validateParamInt(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = safeParseInt(req.params[paramName]);
    if (value === null) {
      res.status(400).json({ error: `Invalid ${paramName}: must be a positive integer` });
      return;
    }
    next();
  };
}

/**
 * Validates a UUID string (v4 format). Returns null if not a valid UUID.
 */
export function safeParseUUID(value: any): string | null {
  if (!value) return null;
  const s = Array.isArray(value) ? value[0] : String(value);
  return UUID_RE.test(s) ? s : null;
}

/**
 * Middleware that validates a route param is a valid UUID.
 */
export function validateParamUUID(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = safeParseUUID(req.params[paramName]);
    if (value === null) {
      res.status(400).json({ error: `Invalid ${paramName}: must be a valid UUID` });
      return;
    }
    next();
  };
}
