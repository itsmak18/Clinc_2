export interface CacheService {
  /** Get cached value, or compute via fetcher on miss and cache for ttlSec. */
  getOrSet<T>(key: string, ttlSec: number, fetcher: () => Promise<T>): Promise<T>;
  /** Invalidate a single key. */
  del(key: string): Promise<void>;
  /** Invalidate all keys matching a glob pattern (e.g., "cache:1:dashboard:*"). */
  invalidatePattern(pattern: string): Promise<void>;
}
