import type { EventBus } from "./event-bus";
import type { RateStore } from "./rate-store";
import type { RevocationStore } from "./revocation-store";
import type { CacheService } from "./cache-service";

export type { EventBus, RateStore, RevocationStore, CacheService };

export interface ScopeCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface Runtime {
  eventBus: EventBus;
  rateStore: RateStore;
  revocationStore: RevocationStore;
  /** Redis-backed doctor-scope cache. Undefined when SESSION_STORE=memory. */
  scopeCache?: ScopeCache;
  /** General-purpose application cache (dashboard/patient/billing read-paths). */
  cache: CacheService;
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
    const { createRedisCacheService } = await import("./redis/cache-service");

    const eventBus = createRedisEventBus(publisher, subscriber);
    const rateStore = createRedisRateStore(client);
    const revocationStore = createRedisRevocationStore(client);
    const cache = createRedisCacheService(client);

    // Scope cache shares the main client connection
    const scopeCache: ScopeCache = {
      get: (key) => client.get(key),
      set: (key, value, _mode, ttl) => client.set(key, value, "EX", ttl).then(() => undefined),
      del: (key) => client.del(key).then(() => undefined),
    };

    console.info("[runtime] session_store=redis");

    return {
      eventBus,
      rateStore,
      revocationStore,
      scopeCache,
      cache,
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
  const { createMemoryCacheService } = await import("./memory/cache-service");

  const eventBus = createMemoryEventBus();
  const rateStore = createMemoryRateStore();
  const revocationStore = createMemoryRevocationStore();
  const cache = createMemoryCacheService();

  console.info("[runtime] session_store=memory (local — no Redis required)");

  return {
    eventBus,
    rateStore,
    revocationStore,
    cache,
    // scopeCache: undefined in memory mode — getDoctorPatientScope falls back to DB on every call
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
export const runtime = await buildRuntime();
