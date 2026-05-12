import type Redis from "ioredis";
import type { RevocationStore } from "../revocation-store";

const TOKEN_TTL_SEC = 8 * 3600;

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
    async dispose() {
      await client.quit();
    },
  };
}
