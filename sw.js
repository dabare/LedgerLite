const CACHE_NAME = "ledgerlite-v19";
const APP_SHELL = self.registration.scope;
const ASSETS = [
  APP_SHELL,
  new URL("./styles.css", self.registration.scope).href,
  new URL("./app.js", self.registration.scope).href,
  new URL("./manifest.webmanifest", self.registration.scope).href,
  new URL("./icons/icon.svg", self.registration.scope).href,
  new URL("./icons/icon-192.png", self.registration.scope).href,
  new URL("./icons/icon-512.png", self.registration.scope).href
];

self.addEventListener("install", event => {
  event.waitUntil(precache());
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

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(ASSETS.map(async url => {
    const response = await fetch(new Request(url, { cache: "reload" }));
    if (response.ok && !response.redirected) {
      await cache.put(url, response);
    }
  }));
}

async function appShellResponse() {
  const cached = await caches.match(APP_SHELL);
  if (cached) {
    return cleanHtmlResponse(cached);
  }

  try {
    const response = await fetch(new Request(APP_SHELL, { cache: "reload" }));
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      const clean = await cleanHtmlResponse(response);
      await cache.put(APP_SHELL, clean.clone());
      return clean;
    }
  } catch (error) {
    // Fall through to the explicit offline response below.
  }

  return new Response("Offline app shell is not cached yet. Open the app once while online.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

async function cleanHtmlResponse(response) {
  const body = await response.clone().text();
  return new Response(body, {
    status: 200,
    statusText: "OK",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached && !cached.redirected) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return cached || appShellResponse();
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(appShellResponse());
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
