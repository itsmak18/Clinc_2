/**
 * Express Request type augmentation.
 *
 * Adds the fields the v7 auth kernel and the correlation-ID middleware attach
 * to every request, so service/audit code can read them without `(req as any)`
 * casts. Phase 3.1 of the 2026-05-30 remediation roadmap.
 *
 * `user` is optional because public routes (`scope: "public"` in the kernel)
 * never populate it. Authenticated routes always do — middlewares/auth-gate.ts
 * sets it before calling next().
 *
 * `id` is set by middlewares/correlationId.ts before pinoHttp, so every log
 * line and audit entry carries the same request ID.
 */

export {};

declare global {
  namespace Express {
    interface Request {
      /** Correlation ID set by middlewares/correlationId.ts, picked up by pino-http. */
      id?: string;
      /** Populated by middlewares/auth-gate.ts on success. Absent on public routes. */
      user?: {
        userId: number;
        username: string;
        role: string;
        clinicId: number;
        jwtExpUnix: number;
      };
    }
  }
}
