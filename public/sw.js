/*
 * muscify offline shell.
 *
 * Scope is deliberately narrow, because the obvious failure mode for a service
 * worker on a music app is serving stale catalogue data that looks current.
 *
 * What is cached:
 *   - the offline page, so a cold start with no network shows something useful
 *   - /_next/static/* — content-hashed and immutable, so cache-first is both
 *     safe and the only correct policy
 *
 * What is never cached:
 *   - /api/*, always. Catalogue and search results go stale the moment they are
 *     written, and an app that shows yesterday's chart as though it were today's
 *     is worse than one that says it is offline
 *   - navigation HTML, beyond the offline fallback
 *
 * The trade: this makes the app *open* offline, with its assets present, but it
 * does not cache music for offline listening. Caching audio from third-party
 * streams is a rights question, not an engineering one, and free streams are
 * mostly not CORS-readable anyway. Playlists and history still render, because
 * those come from localStorage and are in the page already.
 */

const VERSION = "muscify-v1";
const OFFLINE_URL = "/offline";

const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // addAll is atomic: if any single entry 404s the whole install fails,
      // which is what we want. A half-installed worker is worse than none.
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only. A worker must not intercept a third-party media request:
  // it cannot cache the opaque response usefully, and intercepting it can break
  // range requests, which is how audio seeking works.
  if (url.origin !== self.location.origin) return;

  // Never cache the API. See the note at the top.
  if (url.pathname.startsWith("/api/")) return;

  // Hashed build output: safe to serve from cache without revalidating.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations: network first, so a fresh page is the normal case, and the
  // offline page is the fallback rather than a stale copy of the last one.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit || caches.match("/")),
      ),
    );
  }
});