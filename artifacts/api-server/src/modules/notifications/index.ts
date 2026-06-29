/**
 * Notifications module — public surface (barrel).
 *
 * Owns the in-app notification list + the authenticated SSE stream
 * (GET /notifications/stream, graceful-drain aware). Other modules push events
 * via lib/sse `emitToUser` (platform), NOT this service. Self-contained leaf;
 * `notificationsRouter` is authed.
 */
export { default as notificationsRouter } from "./notifications.routes";
