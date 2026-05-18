import type Redis from "ioredis";
import type { RevocationStore } from "../revocation-store";
import { MAX_ROLE_TTL_SEC } from "../../../lib/auth-constants";

const TOKEN_TTL_SEC = MAX_ROLE_TTL_SEC; // max role JWT lifetime (4h)

export function createRedisRevocationStore(client: Redis): RevocationStore {
  return {
    async revoke(userId, atSec) {
      await client.set(
        `revoked_tokens_for_user:${userId}`,
        atSec.toString(),
        "EX",
        TOKEN_TTL_SEC,
      );
    },
    async getRevokedAt(userId) {
      const val = await client.get(`revoked_tokens_for_user:${userId}`);
      return val !== null ? parseInt(val, 10) : null;
    },
    async isJtiUsed(jti) {
      const val = await client.get(`used_jti:${jti}`);
      return val !== null;
    },
    async markJtiUsed(jti) {
      // Per-jti key with TTL aligned to max token expiry (4h).
      await client.set(`used_jti:${jti}`, "1", "EX", TOKEN_TTL_SEC);
    },
    async dispose() {
      await client.quit();
    },
  };
}
