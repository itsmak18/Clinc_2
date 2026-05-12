import type { RevocationStore } from "../revocation-store";

const TOKEN_TTL_SEC = 8 * 3600; // must match JWT expiry in auth.ts

export function createMemoryRevocationStore(): RevocationStore {
  const revoked = new Map<number, number>(); // userId → revokedAtSec

  // Prune entries older than the token lifetime so the map stays bounded.
  const sweep = setInterval(() => {
    const cutoff = Math.floor(Date.now() / 1000) - TOKEN_TTL_SEC;
    for (const [uid, ts] of revoked) {
      if (ts < cutoff) revoked.delete(uid);
    }
  }, 60_000).unref();

  return {
    async revoke(userId, atSec) {
      revoked.set(userId, atSec);
    },
    async getRevokedAt(userId) {
      return revoked.get(userId) ?? null;
    },
    async dispose() {
      clearInterval(sweep);
      revoked.clear();
    },
  };
}
