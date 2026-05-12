import type Redis from "ioredis";
import RedisStore from "rate-limit-redis";
import type { RateStore } from "../rate-store";

export function createRedisRateStore(client: Redis): RateStore {
  return {
    createExpressStore() {
      return new RedisStore({
        sendCommand: (...args: string[]) => {
          const [command, ...rest] = args;
          return client.call(command, ...rest) as any;
        },
      });
    },
    async dispose() {
      await client.quit();
    },
  };
}
