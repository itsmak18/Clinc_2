import type Redis from "ioredis";
import type { EventBus } from "../event-bus";

export function createRedisEventBus(
  publisher: Redis,
  subscriber: Redis,
): EventBus {
  return {
    async publish(channel, payload) {
      await publisher.publish(channel, payload);
    },
    subscribe(channel, handler) {
      subscriber.subscribe(channel).catch(() => {});
      subscriber.on("message", listener);
      function listener(ch: string, msg: string) {
        if (ch === channel) handler(msg);
      }
      return () => subscriber.off("message", listener);
    },
    async dispose() {
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
