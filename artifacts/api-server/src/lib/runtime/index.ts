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

function buildRuntime(): Runtime {
  if (sessionStore === "redis") {
    const Redis = require("ioredis") as typeof import("ioredis").default;
    const REDIS_URL = process.env["REDIS_URL"] || "redis://localhost:6379";
    const opts = { maxRetriesPerRequest: null, enableReadyCheck: false };

    const publisher = new Redis(REDIS_URL, opts);
    const subscriber = new Redis(REDIS_URL, opts);
    const client = new Redis(REDIS_URL, opts);

    const { createRedisEventBus } = require("./redis/event-bus") as typeof import("./redis/event-bus");
    const { createRedisRateStore } = require("./redis/rate-store") as typeof import("./redis/rate-store");
    const { createRedisRevocationStore } = require("./redis/revocation-store") as typeof import("./redis/revocation-store");

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

  const { createMemoryEventBus } = require("./memory/event-bus") as typeof import("./memory/event-bus");
  const { createMemoryRateStore } = require("./memory/rate-store") as typeof import("./memory/rate-store");
  const { createMemoryRevocationStore } = require("./memory/revocation-store") as typeof import("./memory/revocation-store");

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

export const runtime = buildRuntime();
