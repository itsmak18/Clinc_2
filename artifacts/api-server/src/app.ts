import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { correlationId } from "./middlewares/correlationId";
import { metricsMiddleware, getMetrics } from "./lib/metrics";
import { ipRateLimit } from "./middlewares/rateLimiter";
import { cspDirectives, cspReportUri } from "./lib/csp";
import { loginShield, loginIpRateLimit } from "./middlewares/login-shield";
import { notFoundHandler, globalErrorHandler } from "./middlewares/envelope";
import { httpSpanMiddleware } from "./lib/tracer";

const app: Express = express();

// ── Trust proxy ─────────────────────────────────────────────────────────────
// Caddy/nginx sits on the docker `frontend` bridge network and forwards client
// IPs via X-Forwarded-For. Without this, req.ip resolves to the upstream
// container IP and rate-limit keys, login-shield buckets, and audit IP fields
// collapse to one identity. Trust private-network upstreams only — never
// X-Forwarded-For coming from a public-internet client.
app.set("trust proxy", "loopback, linklocal, uniquelocal");

// ── Security headers ────────────────────────────────────────────────────────
app.use(correlationId); // Must be first: attaches req.id for all subsequent middleware

// OTel HTTP span — established after correlationId so req.id is available for
// the span attribute. Context propagates through the full middleware chain via
// AsyncLocalStorage so any child spans started downstream nest correctly.
// Noop when initTracer() was not called (no OTEL_EXPORTER_OTLP_ENDPOINT set).
app.use(httpSpanMiddleware as any);

// Strip inbound auth-state headers — these are SERVER-asserted only. A client
// must never be able to inject X-Session-State / X-Security-Flags and have
// downstream code trust them. authGate also strips defensively; this runs
// first to protect any middleware that consults headers before the gate.
app.use((req, _res, next) => {
  delete req.headers["x-session-state"];
  delete req.headers["x-security-flags"];
  next();
});

// Phase 2 — when CSP reporting is on, helmet emits `report-uri` so violations
// land at /api/csp-report. When off, the directives object is untouched and
// behavior is identical to Phase 1.
{
  const directives: Record<string, string[]> = { ...cspDirectives };
  const reportPath = cspReportUri();
  if (reportPath) directives.reportUri = [reportPath];
  app.use(helmet({
    contentSecurityPolicy: { directives },
    crossOriginEmbedderPolicy: false, // Relaxed for Replit proxy
  }));
}

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

// ALLOWED_ORIGINS — comma-separated additional prod origins (e.g. https://app.example.com).
// Use this instead of REPLIT_DOMAINS when deploying outside Replit.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean);
const allowedOriginPatterns: RegExp[] = allowedOrigins.map(
  o => new RegExp(`^${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) return callback(null, true);

    const allowed = process.env.NODE_ENV === "production"
      ? [...replitOriginPatterns, ...allowedOriginPatterns]
      : [...devOriginPatterns, ...replitOriginPatterns, ...allowedOriginPatterns];

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
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${token}`) {
      res.status(401).end();
      return;
    }
  }
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

// ── 404 + global error handlers (canonical envelope) ────────────────────────
// Both live in middlewares/envelope.ts so they can be tested without booting
// the full app. See src/tests/envelope.integration.test.ts.
app.use(notFoundHandler);
app.use(globalErrorHandler);

export default app;
