import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { correlationId } from "./middlewares/correlationId";
import { metricsMiddleware, getMetrics } from "./lib/metrics";
import { ipRateLimit } from "./middlewares/rateLimiter";
import { cspDirectives } from "./lib/csp";
import { loginShield, loginIpRateLimit } from "./middlewares/login-shield";

const app: Express = express();

// ── Security headers ────────────────────────────────────────────────────────
app.use(correlationId); // Must be first: attaches req.id for all subsequent middleware

// Strip inbound auth-state headers — these are SERVER-asserted only. A client
// must never be able to inject X-Session-State / X-Security-Flags and have
// downstream code trust them. authGate also strips defensively; this runs
// first to protect any middleware that consults headers before the gate.
app.use((req, _res, next) => {
  delete req.headers["x-session-state"];
  delete req.headers["x-security-flags"];
  next();
});

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false, // Relaxed for Replit proxy
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
// Callback-based origin checker — never falls back to wildcard (N-03)
const devOriginPatterns: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

const replitDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
const replitOriginPatterns: RegExp[] = replitDomains.map(
  d => new RegExp(`^https://${d.replace(/\./g, "\\.")}$`)
);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) return callback(null, true);

    const allowed = process.env.NODE_ENV === "production" 
      ? [...replitOriginPatterns] 
      : [...devOriginPatterns, ...replitOriginPatterns];
      
    if (allowed.some(pattern => pattern.test(origin))) {
      callback(null, true);
    } else {
      logger.warn({ origin }, "CORS: rejected origin");
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-CSRF-Token"], // X-CSRF-Token required for CSRF protection
  credentials: true,
  maxAge: 86400,
}));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Metrics ───────────────────────────────────────────────────────────────────
app.use(metricsMiddleware);
app.get("/metrics", (req: Request, res: Response) => {
  getMetrics(req, res).catch(() => res.status(500).end());
});

// ── Body parsing with size cap ────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// ── CSRF protection ─────────────────────────────────────────────────────────
// No global csrfProtect mount: CSRF is now enforced inside the auth kernel
// (`lib/policy.ts` → `evaluate`) on write/privileged scopes for mutation
// methods. The legacy `middlewares/csrf.ts` is deleted.

// ── Routes ────────────────────────────────────────────────────────────────────
// Global rate limiting for all mutation endpoints
const globalMutationLimiter = ipRateLimit(100, 15 * 60 * 1000);
app.use("/api", (req, res, next) => {
  // /auth/login: apply the login shield (hygiene + IP rate limit) before
  // the global mutation limiter, so abuse is rejected earliest.
  if (req.method === "POST" && req.path === "/auth/login") {
    return loginShield(req, res, () => loginIpRateLimit(req, res, next));
  }
  // All other mutations: global rate limiter (skip Redis on unauthenticated login).
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.path !== "/auth/login") {
    return globalMutationLimiter(req, res, next);
  }
  return next();
});
app.use("/api", router);

// ── 404 handler for unmatched routes ────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Must have 4 params for Express to recognize it as an error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({
    err: { message: err.message, stack: err.stack, name: err.name },
    method: req.method,
    url: req.url?.split("?")[0],
    userId: (req as any).user?.userId,
  });

  // PostgreSQL unique violation — return 409 instead of exposing the stack trace
  if ((err as any).code === "23505") {
    res.status(409).json({ error: "Duplicate record — this entry already exists." });
    return;
  }
  // PostgreSQL foreign key violation
  if ((err as any).code === "23503") {
    res.status(400).json({ error: "Referenced record does not exist." });
    return;
  }

  // Never expose stack traces in production
  res.status(500).json({
    error: "Internal server error",
    ...(process.env.NODE_ENV === "development" ? { detail: err.message } : {}),
  });
});

export default app;
