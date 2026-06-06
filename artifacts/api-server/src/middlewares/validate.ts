import type { Request, Response, NextFunction, RequestHandler } from "express";
import { buildEnvelope } from "./envelope";
import { E } from "../errors";

/**
 * Request-validation middleware backed by the Orval-generated Zod schemas in
 * `@workspace/api-zod`.
 *
 * Design decisions:
 *  - **Validate, don't transform.** On success the request is left UNCHANGED —
 *    we deliberately do NOT replace `req[source]` with the parsed value. The
 *    generated schemas strip unknown keys and apply coercions (e.g.
 *    `coerce.date`), neither of which we want to leak into the service layer:
 *    services still parse/normalize their own inputs (`Number(...)`, JSONB guard
 *    schemas, field encryption) and some routes intentionally pass extra fields
 *    (e.g. xray/ultrasound `findingsAr`/`impressionAr`). This is pure input
 *    validation at the HTTP boundary, additive and non-breaking.
 *  - **Emit the canonical envelope directly.** This runs as middleware *before*
 *    the asyncHandler-wrapped handler, so a thrown/`next(err)` domain error would
 *    fall through to the global handler (→ 500). We render the 400 DOMAIN_VALIDATION
 *    envelope here via `buildEnvelope` so the shape matches every other error path.
 *  - **Zod-version agnostic.** The generated schemas may be a different zod
 *    instance than the app's `zod/v4`; we only rely on the structural `safeParse`
 *    contract, so no cross-version type coupling.
 */
type Source = "body" | "query" | "params";

interface ParsableSchema {
  safeParse(data: unknown): { success: boolean };
}

interface ZodLikeFailure {
  success: false;
  error?: { issues?: Array<{ path?: Array<string | number>; message?: string }> };
}

export function validate(schema: ParsableSchema, source: Source = "body"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const target = source === "body" ? req.body : source === "query" ? req.query : req.params;
    const result = schema.safeParse(target) as { success: true } | ZodLikeFailure;

    if (result.success) {
      next();
      return;
    }

    const issue = result.error?.issues?.[0];
    const where = issue?.path && issue.path.length > 0 ? issue.path.join(".") : source;
    const message = issue?.message ? `${where}: ${issue.message}` : `Invalid request ${source}`;

    res.status(E.DOMAIN_VALIDATION.status).json(buildEnvelope(req, E.DOMAIN_VALIDATION, message));
  };
}
