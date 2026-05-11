import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";

export interface AuthRequest extends Request {
  user?: { userId: number; username: string; role: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  // Read token from HttpOnly cookie — never from Authorization header
  const rawToken = req.cookies?.clinic_token ?? null;
  if (!rawToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyToken(rawToken);
    req.user = { userId: payload.userId, username: payload.username, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    // super_admin MUST bypass ALL role checks — architectural invariant.
    // This is enforced here centrally so callers never need to include 'super_admin' explicitly.
    if (req.user.role === "super_admin") { next(); return; }
    if (!roles.includes(req.user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  };
}
