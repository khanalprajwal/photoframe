const CACHE_VERSION = "v1";
const IMAGE_CACHE = `photoframe-images-${CACHE_VERSION}`;
const MANIFEST_CACHE = `photoframe-manifest-${CACHE_VERSION}`;
const IMAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![IMAGE_CACHE, MANIFEST_CACHE].includes(k))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isManifestRequest(url) {
  return url.pathname.endsWith("/images.json") || url.pathname === "/images.json";
}

function isImageRequest(request, url) {
  return request.destination === "image" || url.pathname.startsWith(`${self.registration.scope.replace(self.location.origin, "")}images/`);
}

async function stampResponse(response) {
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set("x-sw-cache-time", String(Date.now()));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handleManifestRequest(request) {
  const cache = await caches.open(MANIFEST_CACHE);

  try {
    const networkResponse = await fetch(request, { cache: "no-cache" });
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function handleImageRequest(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    const cachedAt = Number(cached.headers.get("x-sw-cache-time") || 0);
    const isFresh = cachedAt > 0 && (Date.now() - cachedAt) < IMAGE_MAX_AGE_MS;

    if (isFresh) {
      return cached;
    }

    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        const stamped = await stampResponse(networkResponse.clone());
        await cache.put(request, stamped);
        return networkResponse;
      }
      return cached;
    } catch (err) {
      return cached;
    }
  }

  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    const stamped = await stampResponse(networkResponse.clone());
    await cache.put(request, stamped);
  }
  return networkResponse;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (isManifestRequest(url)) {
    event.respondWith(handleManifestRequest(request));
    return;
  }

  if (isImageRequest(request, url)) {
    event.respondWith(handleImageRequest(request));
  }
});
