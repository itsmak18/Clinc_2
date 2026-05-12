import type { Response } from "express";
import { runtime } from "./runtime";
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

const SSE_CHANNEL = "medicore_sse_events";

// Module-level subscription — one handler for all SSE fan-out regardless of adapter.
runtime.eventBus.subscribe(SSE_CHANNEL, (message) => {
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
    logger.error({ err }, "Failed to process SSE message");
  }
});

export function emitToUser(userId: number, event: string, data: unknown): void {
  const message = JSON.stringify({ userId, event, data });
  runtime.eventBus.publish(SSE_CHANNEL, message).catch((err) => {
    logger.error({ err }, "Failed to publish SSE event");
  });
}
