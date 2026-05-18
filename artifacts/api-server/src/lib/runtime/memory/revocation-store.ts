import type { RevocationStore } from "../revocation-store";
import { MAX_ROLE_TTL_SEC } from "../../../lib/auth-constants";

const TOKEN_TTL_SEC = MAX_ROLE_TTL_SEC; // max role JWT lifetime (4h)
const JTI_TTL_MS = 4 * 3600 * 1000; // max token lifetime; prune used jtis beyond this

export function createMemoryRevocationStore(): RevocationStore {
  const revoked = new Map<number, number>(); // userId → revokedAtSec
  const usedJtis = new Map<string, number>(); // jti → recordedAtMs

  // Prune entries older than the token lifetime so the maps stay bounded.
  const sweep = setInterval(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoffSec = nowSec - TOKEN_TTL_SEC;
    for (const [uid, ts] of revoked) {
      if (ts < cutoffSec) revoked.delete(uid);
    }
    const cutoffMs = Date.now() - JTI_TTL_MS;
    for (const [jti, ts] of usedJtis) {
      if (ts < cutoffMs) usedJtis.delete(jti);
    }
  }, 60_000).unref();

  return {
    async revoke(userId, atSec) {
      revoked.set(userId, atSec);
    },
    async getRevokedAt(userId) {
      return revoked.get(userId) ?? null;
    },
    async isJtiUsed(jti) {
      return usedJtis.has(jti);
    },
    async markJtiUsed(jti) {
      usedJtis.set(jti, Date.now());
    },
    async dispose() {
      clearInterval(sweep);
      revoked.clear();
      usedJtis.clear();
    },
  };
}
