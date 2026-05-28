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

/**
 * Drain every open SSE connection — required during graceful shutdown (H7).
 *
 * server.close() waits for all open HTTP connections to finish. SSE responses
 * are long-lived (Connection: keep-alive, never naturally finishing), so
 * without this call server.close() would hang until the timeout failsafe
 * force-killed the process.
 *
 * Each connection gets a per-connection random `retry:` field (5–15 s) before
 * the `reconnect` event so that clients spread their reconnects across the
 * window rather than all hitting the new pod simultaneously (thundering herd).
 * The frontend's `reconnect` event handler reads `data.retryAfter` and uses
 * that value as its reconnect delay.
 */
export function closeAllSSEClients(): number {
  let closed = 0;
  for (const [, set] of clients) {
    for (const res of set) {
      try {
        // Jitter per connection: 5 000–15 000 ms.
        const retryAfter = 5000 + Math.floor(Math.random() * 10000);
        res.write(
          `retry: ${retryAfter}\nevent: reconnect\ndata: ${JSON.stringify({ reason: "server_draining", retryAfter })}\n\n`,
        );
        res.end();
      } catch {
        // Connection already gone — fine.
      }
      closed++;
    }
  }
  clients.clear();
  return closed;
}
