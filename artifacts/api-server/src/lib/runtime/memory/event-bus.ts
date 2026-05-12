import { EventEmitter } from "node:events";
import type { EventBus } from "../event-bus";

export function createMemoryEventBus(): EventBus {
  const ee = new EventEmitter();
  ee.setMaxListeners(0);

  return {
    async publish(channel, payload) {
      // setImmediate keeps publish non-reentrant — mirrors Redis async semantics
      setImmediate(() => ee.emit(channel, payload));
    },
    subscribe(channel, handler) {
      ee.on(channel, handler);
      return () => ee.off(channel, handler);
    },
    async dispose() {
      ee.removeAllListeners();
    },
  };
}
