import type { EventBus } from "./event-bus";
import type { RateStore } from "./rate-store";
import type { RevocationStore } from "./revocation-store";

export type { EventBus, RateStore, RevocationStore };

export interface Runtime {
  eventBus: EventBus;
  rateStore: RateStore;
  revocationStore: RevocationStore;
  dispose(): Promise<void>;
}

// SESSION_STORE defaults to "memory" unless we're in production.
// In production, set SESSION_STORE=redis and provide REDIS_URL.
const sessionStore =
  process.env["SESSION_STORE"] ??
  (process.env["NODE_ENV"] === "production" ? "redis" : "memory");

if (process.env["NODE_ENV"] === "production" && sessionStore === "memory") {
  console.warn(
    "[runtime] WARNING: SESSION_STORE=memory in production. " +
    "Rate-limit counters and session revocations will reset on restart. " +
    "Set SESSION_STORE=redis for production deployments.",
  );
}

// Uses dynamic import() instead of require() so this module works correctly
// under both Vitest (native ESM, no banner shim) and the esbuild prod bundle.
async function buildRuntime(): Promise<Runtime> {
  if (sessionStore === "redis") {
    const { default: Redis } = await import("ioredis");
    const REDIS_URL = process.env["REDIS_URL"] || "redis://localhost:6379";
    const opts = { maxRetriesPerRequest: null, enableReadyCheck: false };

    const publisher = new Redis(REDIS_URL, opts);
    const subscriber = new Redis(REDIS_URL, opts);
    const client = new Redis(REDIS_URL, opts);

    const { createRedisEventBus } = await import("./redis/event-bus");
    const { createRedisRateStore } = await import("./redis/rate-store");
    const { createRedisRevocationStore } = await import("./redis/revocation-store");

    const eventBus = createRedisEventBus(publisher, subscriber);
    const rateStore = createRedisRateStore(client);
    const revocationStore = createRedisRevocationStore(client);

    console.info("[runtime] session_store=redis");

    return {
      eventBus,
      rateStore,
      revocationStore,
      async dispose() {
        await Promise.all([
          eventBus.dispose(),
          revocationStore.dispose(),
        ]);
      },
    };
  }

  const { createMemoryEventBus } = await import("./memory/event-bus");
  const { createMemoryRateStore } = await import("./memory/rate-store");
  const { createMemoryRevocationStore } = await import("./memory/revocation-store");

  const eventBus = createMemoryEventBus();
  const rateStore = createMemoryRateStore();
  const revocationStore = createMemoryRevocationStore();

  console.info("[runtime] session_store=memory (local — no Redis required)");

  return {
    eventBus,
    rateStore,
    revocationStore,
    async dispose() {
      await Promise.all([
        eventBus.dispose(),
        rateStore.dispose(),
        revocationStore.dispose(),
      ]);
    },
  };
}

// Top-level await — valid in ESM (package.json "type": "module", target: "es2022").
// This fixes the Vitest ESM mode failure caused by require() calls that only
// worked under the esbuild banner shim in the prod build.
export const runtime = await buildRuntime();
