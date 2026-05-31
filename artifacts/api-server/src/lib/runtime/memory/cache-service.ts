import type { CacheService } from "../cache-service";
import { cacheHitTotal, cacheMissTotal } from "../../metrics";

interface Entry {
  value: string;
  expiresAt: number;
}

function keyPrefix(key: string): string {
  // cache:{clinicId}:{entity}:{...} → "{entity}"
  const parts = key.split(":");
  return parts[2] ?? "unknown";
}

export function createMemoryCacheService(): CacheService {
  const store = new Map<string, Entry>();

  function read(key: string): string | null {
    const e = store.get(key);
    if (!e) return null;
    if (Date.now() >= e.expiresAt) {
      store.delete(key);
      return null;
    }
    return e.value;
  }

  return {
    async getOrSet<T>(key: string, ttlSec: number, fetcher: () => Promise<T>): Promise<T> {
      const cached = read(key);
      const prefix = keyPrefix(key);
      if (cached !== null) {
        cacheHitTotal.labels(prefix).inc();
        return JSON.parse(cached) as T;
      }
      cacheMissTotal.labels(prefix).inc();
      const value = await fetcher();
      store.set(key, {
        value: JSON.stringify(value),
        expiresAt: Date.now() + ttlSec * 1000,
      });
      return value;
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    },
    async invalidatePattern(pattern: string): Promise<void> {
      // Convert glob → regex: only * is significant.
      const re = new RegExp("^" + pattern.split("*").map(escapeRe).join(".*") + "$");
      for (const k of store.keys()) {
        if (re.test(k)) store.delete(k);
      }
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
