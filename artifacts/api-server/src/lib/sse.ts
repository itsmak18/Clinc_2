import type { Response } from "express";
import { redisPublisher, redisSubscriber } from "./redis";
import { logger } from "./logger";

const clients = new Map<number, Set<Response>>();

export function addSSEClient(userId: number, res: Response): void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);
}

export function removeSSEClient(userId: number, res: Response): void {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

// Subscribe to the global SSE channel for fanout
const SSE_CHANNEL = "medicore_sse_events";

redisSubscriber.subscribe(SSE_CHANNEL, (err) => {
  if (err) logger.error({ err }, "Failed to subscribe to SSE channel");
});

redisSubscriber.on("message", (channel, message) => {
  if (channel !== SSE_CHANNEL) return;
  try {
    const { userId, event, data } = JSON.parse(message);
    const set = clients.get(userId);
    if (!set || set.size === 0) return;
    
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to process incoming SSE Redis message");
  }
});

// Emit to the Redis Pub/Sub channel so all instances get the event
export function emitToUser(userId: number, event: string, data: unknown): void {
  const message = JSON.stringify({ userId, event, data });
  redisPublisher.publish(SSE_CHANNEL, message).catch((err) => {
    logger.error({ err }, "Failed to publish SSE event to Redis");
  });
}
