import type Redis from "ioredis";
import type { CacheService } from "../cache-service";
import { cacheHitTotal, cacheMissTotal } from "../../metrics";
import { logger } from "../../logger";

function keyPrefix(key: string): string {
  const parts = key.split(":");
  return parts[2] ?? "unknown";
}

export function createRedisCacheService(client: Redis): CacheService {
  return {
    async getOrSet<T>(key: string, ttlSec: number, fetcher: () => Promise<T>): Promise<T> {
      const prefix = keyPrefix(key);
      try {
        const cached = await client.get(key);
        if (cached !== null) {
          cacheHitTotal.labels(prefix).inc();
          return JSON.parse(cached) as T;
        }
      } catch (err) {
        // Redis unavailable — fall through to fetcher. Never block the request.
        logger.warn({ err, key }, "cache get failed; falling through to source");
      }
      cacheMissTotal.labels(prefix).inc();
      const value = await fetcher();
      // Best-effort write — failure to cache must not fail the request.
      client.set(key, JSON.stringify(value), "EX", ttlSec).catch((err) => {
        logger.warn({ err, key }, "cache set failed");
      });
      return value;
    },
    async del(key: string): Promise<void> {
      try {
        await client.del(key);
      } catch (err) {
        logger.warn({ err, key }, "cache del failed");
      }
    },
    async invalidatePattern(pattern: string): Promise<void> {
      try {
        let cursor = "0";
        do {
          const [next, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 200);
          cursor = next;
          if (keys.length > 0) {
            // UNLINK is non-blocking; falls back to DEL on older Redis.
            await client.unlink(...keys).catch(() => client.del(...keys));
          }
        } while (cursor !== "0");
      } catch (err) {
        logger.warn({ err, pattern }, "cache invalidatePattern failed");
      }
    },
  };
}
