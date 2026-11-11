// Service worker for Juliana's Wishlist.
// BUMP CACHE_VERSION ON EVERY DEPLOY so phones pick up the new files
// (open tabs then show "Update available · Refresh").
const CACHE_VERSION = "wishlist-v3";
const FONT_CACHE = "wishlist-fonts-v1";

// App shell, relative to this file so it works from the Pages subpath.
const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];
const PRECACHE_URLS = new Set(PRECACHE.map((path) => new URL(path, self.registration.scope).href));
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // cache: "reload" skips the HTTP cache (GitHub Pages sets max-age=600),
      // so a new version never precaches stale files.
      .then((cache) => cache.addAll(PRECACHE.map((path) => new Request(path, { cache: "reload" }))))
  );
  // No skipWaiting() here: the page asks first ("Update available · Refresh").
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION && key !== FONT_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// The page posts this when the person taps "Refresh".
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Google Fonts: stale-while-revalidate.
  if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin !== self.location.origin) return; // shop images etc. go straight to the network

  // App shell: cache-first. Navigations (any query string) get index.html.
  if (request.mode === "navigate") {
    event.respondWith(cacheFirst(new URL("./index.html", self.registration.scope).href, request));
    return;
  }
  url.search = "";
  if (PRECACHE_URLS.has(url.href)) event.respondWith(cacheFirst(url.href, request));
});

async function cacheFirst(key, request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(key, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      // Font CSS/files are fetched no-cors, so responses may be opaque (status 0).
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}
