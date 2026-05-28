// Process-wide lifecycle state. Single source of truth that other modules
// (readiness probe, request middleware that wants to fast-reject during
// drain, etc.) can observe.
//
// H7 (graceful shutdown): index.ts flips `isShuttingDown` to true on SIGTERM
// BEFORE any other shutdown step. The readiness endpoint then reports 503
// so the load balancer / Caddy stops sending new requests within one health-
// check interval, while in-flight requests finish on the existing pod.

let _shuttingDown = false;

export function isShuttingDown(): boolean {
  return _shuttingDown;
}

export function beginShutdown(): void {
  _shuttingDown = true;
}
