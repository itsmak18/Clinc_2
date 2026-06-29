/**
 * Health module — public surface (barrel).
 *
 * Owns liveness/readiness endpoints (checkReadiness probes DB + Redis,
 * shutdown-aware). Self-contained leaf; `healthRouter` is anonymous (public
 * health checks, registered early in routes/index.ts).
 */
export { default as healthRouter } from "./health.routes";
