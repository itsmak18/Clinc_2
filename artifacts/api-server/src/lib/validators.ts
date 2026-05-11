import type { Request, Response, NextFunction } from "express";

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
