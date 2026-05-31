import type { Response } from "express";
import { runtime } from "./runtime";
import { logger } from "./logger";
import { sseConnectionsGauge } from "./metrics";

const clients = new Map<number, Set<Response>>();
let totalConnections = 0;

// Safety nets; not expected to hit at current scale (~20 internal users).
const MAX_CONNECTIONS = parseInt(process.env.SSE_MAX_CONNECTIONS ?? "500", 10);
const MAX_PER_USER    = parseInt(process.env.SSE_MAX_PER_USER    ?? "10",  10);

/**
 * Register a new SSE client. Returns false when the per-process cap has been
 * reached — the caller must respond 503 + Retry-After. When the per-user cap
 * is reached, the oldest connection for that user is evicted to make room.
 */
export function addSSEClient(userId: number, res: Response): boolean {
  if (totalConnections >= MAX_CONNECTIONS) return false;
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  if (set.size >= MAX_PER_USER) {
    const oldest = set.values().next().value;
    if (oldest) {
      try { oldest.end(); } catch { /* already closed */ }
      set.delete(oldest);
      totalConnections--;
    }
  }
  set.add(res);
  totalConnections++;
  sseConnectionsGauge.set(totalConnections);
  return true;
}

export function removeSSEClient(userId: number, res: Response): void {
  const set = clients.get(userId);
  if (!set) return;
  if (set.delete(res)) totalConnections--;
  if (set.size === 0) clients.delete(userId);
  sseConnectionsGauge.set(totalConnections);
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
  totalConnections = 0;
  sseConnectionsGauge.set(0);
  return closed;
}
