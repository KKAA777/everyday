/* EVERYDAY offline support.
   Keeps a copy of the app on the device so it opens with no network.
   Online, the page always comes from the network (so updates show up);
   offline, or if the network takes too long, the saved copy is used.

   If you change THIS file or the icons, bump VERSION (v2, v3, ...).
   Changing index.html alone needs no bump. */

const VERSION = "v2";
// Internal label for the offline copies. Don't rename it later, or old copies won't be cleaned up.
const PREFIX = "everyday-";
// Copies saved under the app's earlier, misspelled name; removed once, then never used.
const LEGACY_PREFIXES = ["erevyday-"];
const CACHE = PREFIX + VERSION;
const PAGE = new URL("index.html", self.location).href;
const EXTRAS = ["manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png"].map(
  (path) => new URL(path, self.location).href
);
const SCOPE_PATH = new URL("./", self.location).pathname;
const NETWORK_WAIT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The page itself must be saved, or offline cannot work.
    await cache.add(new Request(PAGE, { cache: "reload" }));
    // Icons and the manifest are nice to have; a missing one must not block install.
    await Promise.allSettled(
      EXTRAS.map((url) => cache.add(new Request(url, { cache: "reload" })))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Only remove this app's older copies. Other projects on the same
    // github.io address share this storage and are left alone.
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) =>
          (key.startsWith(PREFIX) && key !== CACHE) ||
          LEGACY_PREFIXES.some((old) => key.startsWith(old))
        )
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  if (request.mode === "navigate") {
    const network = fetch(request);
    // Refresh the saved page whenever the network answers.
    event.waitUntil(
      network
        .then((response) => {
          if (!response.ok) return;
          const copy = response.clone();
          return caches.open(CACHE).then((cache) => cache.put(PAGE, copy));
        })
        .catch(() => {})
    );
    event.respondWith(openPage(network));
    return;
  }

  event.respondWith(openAsset(event));
});

async function openPage(network) {
  try {
    const response = await Promise.race([network, timeout(NETWORK_WAIT_MS)]);
    if (response.ok || response.type === "opaqueredirect") return response;
    return (await caches.match(PAGE)) || response;
  } catch {
    // No network, or too slow: use the saved page.
    // Nothing saved yet (very first visit): keep waiting for the network.
    return (await caches.match(PAGE)) || network;
  }
}

async function openAsset(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
  }
  return response;
}

function timeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("network timeout")), ms);
  });
}
