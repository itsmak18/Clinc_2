import type { Request, Response, NextFunction, RequestHandler } from "express";
import { evaluate, sendDecision, type Scope, type Decision } from "../lib/policy";
import { logger } from "../lib/logger";
import { E } from "../errors";

export interface AuthRequest extends Request {
  user?: { userId: number; username: string; role: string; clinicId: number; jwtExpUnix: number };
}

export function authGate(scope: Scope, allowedRoles?: string[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Strip inbound auth header injection — self-asserting headers from clients
    // must never reach handlers.
    if (req.headers["x-session-state"]) {
      logger.error({ request_id: req.id, msg: "SECURITY: x-session-state reached authGate" });
      delete req.headers["x-session-state"];
    }
    if (req.headers["x-security-flags"]) {
      delete req.headers["x-security-flags"];
    }

    const d: Decision = await evaluate(req, scope, allowedRoles).catch((e: unknown) => {
      logger.error({ request_id: req.id, msg: "evaluate-threw", error: String(e) });
      return { ok: false, error: E.INFRA_INTERNAL, state: "anon", trace: [] } as Decision;
    });

    if (!d.ok) {
      sendDecision(res, req, d);
      return;
    }

    (req as AuthRequest).user = {
      ...d.user,
      jwtExpUnix: d.meta.sessionTtl != null
        ? Math.floor(Date.now() / 1000) + d.meta.sessionTtl
        : Math.floor(Date.now() / 1000) + 1800,
    };
    res.setHeader("X-Session-State", "authenticated");

    // Success-path observability: baseline for rate alerting on degradation.
    logger.debug({
      msg: "auth_pass",
      request_id: req.id,
      user_id: d.user.userId,
      role: d.user.role,
      scope,
      session_ttl: d.meta.sessionTtl,
    });

    if (d.meta.sessionTtl !== null && d.meta.sessionTtl < 60) {
      res.setHeader("X-Security-Flags", "session_refresh_advisory");
    }

    next();
  };
}
