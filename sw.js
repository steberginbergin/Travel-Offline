const SHELL_CACHE = "tt-shell-v2";
const DATA_CACHE = "tt-data-v1";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./camera.js",
  "./manifest.json",
  "./data/phrasebook.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // App shell: same-origin — cache-first so the app opens with no signal.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached))
    );
    return;
  }

  // Third-party OCR engine + language data (tesseract core/wasm/traineddata):
  // cache once downloaded so later use is fully offline.
  if (url.hostname.includes("cdnjs.cloudflare.com") || url.pathname.endsWith(".traineddata.gz") || url.pathname.endsWith(".traineddata")) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })
    );
  }
});
