import type { RateStore } from "../rate-store";

// express-rate-limit's built-in MemoryStore is used when no store is passed.
// It already handles sliding-window, per-key TTL, and cleanup — no hand-rolling needed.
export function createMemoryRateStore(): RateStore {
  return {
    createExpressStore: () => undefined, // undefined → library picks MemoryStore
    async dispose() {},
  };
}
