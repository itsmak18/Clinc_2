import type { Response } from "express";
import { runtime } from "./runtime";
import { logger } from "./logger";
import { sseConnectionsGauge } from "./metrics";

const clients = new Map<number, Set<Response>>();
let totalConnections = 0;

// Clinic-scoped fan-out for board-refresh broadcasts (cross-role real-time).
// Keyed by clinicId; `resClinic` is the reverse index so removeSSEClient (which
// only gets userId+res) can clean up without a clinicId argument.
const clinicClients = new Map<number, Set<Response>>();
const resClinic = new Map<Response, number>();

// Safety nets; not expected to hit at current scale (~20 internal users).
const MAX_CONNECTIONS = parseInt(process.env.SSE_MAX_CONNECTIONS ?? "500", 10);
const MAX_PER_USER    = parseInt(process.env.SSE_MAX_PER_USER    ?? "10",  10);

// Per-user event ring buffer for Last-Event-ID replay.
// Stores the last SSE_REPLAY_BUFFER events per user so a reconnecting client
// can catch up on events missed during a brief disconnection.
const REPLAY_BUFFER_SIZE = parseInt(process.env.SSE_REPLAY_BUFFER ?? "50", 10);

interface BufferedEvent {
  id:    number;
  event: string;
  data:  unknown;
}

const replayBuffers = new Map<number, BufferedEvent[]>();
// Monotonically increasing per-user event counter.
const eventCounters = new Map<number, number>();

function nextEventId(userId: number): number {
  const n = (eventCounters.get(userId) ?? 0) + 1;
  eventCounters.set(userId, n);
  return n;
}

function appendToReplayBuffer(userId: number, entry: BufferedEvent): void {
  let buf = replayBuffers.get(userId);
  if (!buf) { buf = []; replayBuffers.set(userId, buf); }
  buf.push(entry);
  if (buf.length > REPLAY_BUFFER_SIZE) buf.shift();
}

/**
 * Register a new SSE client. Returns false when the per-process cap has been
 * reached — the caller must respond 503 + Retry-After. When the per-user cap
 * is reached, the oldest connection for that user is evicted to make room.
 *
 * lastEventId: if the reconnecting client sent Last-Event-ID, replay any
 * buffered events newer than that ID before flushing the connection header.
 */
export function addSSEClient(userId: number, res: Response, lastEventId?: number, clinicId?: number): boolean {
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
      unregisterClinic(oldest);
    }
  }
  set.add(res);
  totalConnections++;
  sseConnectionsGauge.set(totalConnections);

  if (clinicId !== undefined) {
    let cset = clinicClients.get(clinicId);
    if (!cset) { cset = new Set(); clinicClients.set(clinicId, cset); }
    cset.add(res);
    resClinic.set(res, clinicId);
  }

  // Replay missed events if the client sent Last-Event-ID.
  if (lastEventId !== undefined && lastEventId > 0) {
    const buf = replayBuffers.get(userId) ?? [];
    const missed = buf.filter(e => e.id > lastEventId);
    for (const e of missed) {
      try {
        res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      } catch {
        // Connection closed before replay finished — harmless.
      }
    }
  }

  return true;
}

// Remove a connection from the clinic fan-out index (no-op if it never joined one).
function unregisterClinic(res: Response): void {
  const cid = resClinic.get(res);
  if (cid === undefined) return;
  const cset = clinicClients.get(cid);
  cset?.delete(res);
  if (cset && cset.size === 0) clinicClients.delete(cid);
  resClinic.delete(res);
}

export function removeSSEClient(userId: number, res: Response): void {
  const set = clients.get(userId);
  if (set) {
    if (set.delete(res)) totalConnections--;
    if (set.size === 0) clients.delete(userId);
    sseConnectionsGauge.set(totalConnections);
  }
  unregisterClinic(res);
}

const SSE_CHANNEL = "medicore_sse_events";

// Module-level subscription — one handler for all SSE fan-out regardless of adapter.
runtime.eventBus.subscribe(SSE_CHANNEL, (message) => {
  try {
    const parsed = JSON.parse(message);

    // Clinic broadcast: a board-refresh hint to every connection in the clinic.
    // IDs-only payload, no per-user replay buffer (a missed refresh self-heals on
    // the next poll/reconnect, so the ring buffer isn't worth the per-user churn).
    if (parsed.clinicId != null && parsed.userId == null) {
      const cset = clinicClients.get(parsed.clinicId);
      if (!cset || cset.size === 0) return;
      const payload = `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`;
      for (const res of cset) {
        try { res.write(payload); } catch { cset.delete(res); }
      }
      return;
    }

    const { userId, event, data } = parsed;
    const set = clients.get(userId);

    const eventId = nextEventId(userId);
    appendToReplayBuffer(userId, { id: eventId, event, data });

    if (!set || set.size === 0) return;

    const payload = `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
 * Broadcast a board-refresh hint to EVERY SSE connection in a clinic — the
 * cross-role real-time path (appointment transitions) so other role boards
 * update live instead of polling every 30s. Goes through the eventBus so all API
 * replicas fan out. Payload MUST be IDs-only (no PHI) — see the SSE PHI rule.
 */
export function emitToClinic(clinicId: number, event: string, data: unknown): void {
  const message = JSON.stringify({ clinicId, event, data });
  runtime.eventBus.publish(SSE_CHANNEL, message).catch((err) => {
    logger.error({ err }, "Failed to publish SSE clinic broadcast");
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
  clinicClients.clear();
  resClinic.clear();
  totalConnections = 0;
  sseConnectionsGauge.set(0);
  return closed;
}
