# ── Stage 1: base ──────────────────────────────────────────────────────────────
# Node 24 Alpine — matches .nvmrc and engines.node constraint.
# Base image pinned by digest (F-08) for reproducible builds — bump via Renovate.
# node:24-alpine as of 2026-07-04.
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base
RUN corepack enable
WORKDIR /app

# ── Stage 2: install ALL workspace dependencies ────────────────────────────────
FROM base AS deps
# Copy workspace manifest files first (layer-cached until they change)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Copy every package.json in the monorepo (needed for pnpm workspace linking)
COPY lib/db/package.json                ./lib/db/
COPY lib/api-spec/package.json          ./lib/api-spec/
COPY lib/api-zod/package.json           ./lib/api-zod/
COPY lib/api-client-react/package.json  ./lib/api-client-react/
COPY artifacts/api-server/package.json  ./artifacts/api-server/
# Install without running lifecycle scripts (no postinstall in CI/Docker)
RUN pnpm install --frozen-lockfile --ignore-scripts --node-linker=hoisted

# ── Stage 3: build the API server (esbuild → single bundled .mjs) ─────────────
FROM deps AS build
# Copy source in dependency order (schemas before the server that imports them)
COPY lib/db/             ./lib/db/
COPY lib/api-spec/       ./lib/api-spec/
COPY lib/api-zod/        ./lib/api-zod/
COPY lib/api-client-react/ ./lib/api-client-react/
COPY artifacts/api-server/ ./artifacts/api-server/
# Run esbuild (bundles everything except external native addons like bcrypt)
RUN pnpm --filter @workspace/api-server run build

# ── Stage 4: minimal runtime image ────────────────────────────────────────────
# esbuild bundles all pure-JS deps into dist/index.mjs.
# Only native addons (bcrypt) must be present at runtime.
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime
WORKDIR /app

# bcrypt uses a pre-compiled .node addon — copy it from the build stage.
# node_modules/bcrypt is the only non-bundled runtime dep.
COPY --from=build /app/node_modules/bcrypt ./node_modules/bcrypt

# Copy the bundled application (index.mjs + pino worker shims written by esbuild-plugin-pino)
COPY --from=build /app/artifacts/api-server/dist ./dist

# Run as non-root for container security
RUN addgroup -S medicore && adduser -S medicore -G medicore
USER medicore

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# SIGTERM is forwarded by Docker stop — the server handles it for graceful shutdown
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
