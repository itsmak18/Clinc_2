# ADR 001: Core Architecture Decisions

## 1. JWT Strategy
**Decision:** Migrate from Node `crypto` HMAC to the `jose` library (RS256/HS256) with explicit `jti` tracking.
**Rationale:** The hand-rolled crypto implementation lacked protection against algorithm confusion attacks. The `jose` library strictly enforces algorithm types. Implementing `jti` inside a Redis blocklist provides robust session fixation protection.

## 2. SSE Approach (Server-Sent Events)
**Decision:** Migrate from in-memory connection mapping to Redis Pub/Sub.
**Rationale:** In-memory maps restrict the application to a single instance. Using Redis Pub/Sub allows horizontally scaled API servers to fan out events globally so patients and doctors receive real-time updates regardless of which node they connect to.

## 3. Database Schema Migrations
**Decision:** Transition from `drizzle push` to `drizzle-kit generate` and `drizzle-kit migrate`.
**Rationale:** `drizzle push` lacks a versioned history and is highly dangerous for production PHI databases as it can silently drop columns. Explicit migrations provide a strict, forward-only audit trail.

## 4. Monorepo Boundaries
**Decision:** Retain the `pnpm` workspace setup (`@workspace/db`, `@workspace/api-server`).
**Rationale:** Ensures absolute type safety across the frontend and backend without duplicating code, while allowing separate deployment pipelines.
