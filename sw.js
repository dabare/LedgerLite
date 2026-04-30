const CACHE_NAME = "ledgerlite-v15";
const APP_SHELL = "./index.html";
const ASSETS = [
  APP_SHELL,
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS.map(asset => new Request(asset, { cache: "reload" })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  );
});

async function cachedAppShell() {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(APP_SHELL) || cache.match(new URL(APP_SHELL, self.location).href);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached && !cached.redirected) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return cached || cachedAppShell();
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      cachedAppShell().then(cached =>
        cached || fetch(event.request).catch(() => Response.error())
      )
    );
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
