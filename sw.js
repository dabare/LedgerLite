const CACHE_NAME = "ledgerlite-v16";
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
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(ASSETS.map(asset => new Request(asset, { cache: "reload" })));
      const shell = await fetch(new Request(APP_SHELL, { cache: "reload" }));
      if (shell.ok && !shell.redirected) {
        await cache.put(new Request("./"), shell.clone());
        await cache.put(new Request(self.registration.scope), shell.clone());
      }
    })
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
  return await cache.match(APP_SHELL)
    || await cache.match(new URL(APP_SHELL, self.location).href)
    || await cache.match("./")
    || await cache.match(self.registration.scope);
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
        cached || fetch(event.request).catch(() => new Response("Offline app shell is not cached yet. Open the app once while online.", {
          status: 503,
          headers: { "Content-Type": "text/plain" }
        }))
      )
    );
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
