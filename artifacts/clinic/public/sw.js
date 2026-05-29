/**
 * MediCore service worker — SPA shell caching for offline resilience.
 *
 * Strategies:
 *   /api/*          → network-only  (PHI must never touch CacheStorage)
 *   navigate        → network-first, stale-cache fallback (offline resilience)
 *   script/style/
 *   font/image      → cache-first   (nginx already serves these immutable;
 *                                    this layer covers offline access)
 *   everything else → network-first
 *
 * Cache versioning: bump APP_CACHE when the caching strategy or SW logic
 * changes. The activate handler deletes all caches with a different name so
 * old entries are pruned on the next SW activation.
 */

const APP_CACHE = "medicore-v1";

// ── Install — skip waiting so the new SW activates immediately ────────────────
self.addEventListener("install", () => {
  self.skipWaiting();
});

// ── Activate — delete stale caches, then claim all clients ───────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== APP_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests — never intercept POST/PATCH/DELETE (mutations).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // ── 1. API: network-only, never cache PHI ────────────────────────────────
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
    event.respondWith(fetch(request));
    return;
  }

  // ── 2. Navigation: network-first, stale fallback ─────────────────────────
  // Ensures users get the latest index.html when online; serves the cached
  // version when offline so the SPA shell loads and can show an offline state.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/")),
        ),
    );
    return;
  }

  // ── 3. Static assets: cache-first ────────────────────────────────────────
  // Vite output filenames are content-hashed (main-abc123.js) so a cached
  // entry is always correct for its URL. Missing entries are fetched once and
  // stored for subsequent offline requests.
  const dest = request.destination;
  if (
    dest === "script" ||
    dest === "style" ||
    dest === "font" ||
    dest === "image" ||
    dest === "manifest"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // ── 4. Everything else: network-first ────────────────────────────────────
  event.respondWith(
    fetch(request).catch(() => caches.match(request)),
  );
});
