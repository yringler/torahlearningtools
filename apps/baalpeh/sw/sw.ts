/// <reference lib="webworker" />
/**
 * Service worker: makes the installed app open and run with no connection.
 *
 * vite.config.ts compiles this file to dist/sw.js and puts two constants in front of it:
 *   PRECACHE  every file of this build (index.html, hashed JS/CSS, icons, manifest)
 *   VERSION   a hash of those files' contents, so any deploy changes sw.js and the browser installs the new worker
 *
 * Strategies:
 *   page navigations   network first (fresh deploys show up), the cached app page when offline or after 3 s
 *   /assets/*          cache first: names are content-hashed, so a cached copy is never stale
 *   /data/m/*          cache first, kept across deploys: one file per masechta, also content-hashed. A masechta is
 *                      saved the first time it is opened; when a new version arrives the old one is deleted.
 *   Google Fonts       stale-while-revalidate, so the Hebrew font also works offline
 *   /api/*, other origins (Turnstile)   never touched
 */
export {};
declare const self: ServiceWorkerGlobalScope;
declare const PRECACHE: string[];
declare const VERSION: string;

const SHELL = `shell-${VERSION}`;
const DATA = "data-v1";
const FONTS = "fonts-v1";
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(PRECACHE);
      // Take over right away. Pages load hashed files that the new worker caches too, and navigations go to the
      // network first, so an open page never ends up mixing two builds' files.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("shell-") && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    if (req.mode === "navigate") return event.respondWith(navigate(req));
    if (url.pathname.startsWith("/data/m/")) return event.respondWith(masechtaFile(req, url));
    return event.respondWith(cacheFirst(req, SHELL));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    return event.respondWith(staleWhileRevalidate(event, FONTS));
  }
});

async function navigate(req: Request): Promise<Response> {
  // The app shell is precached as "/" (Cloudflare redirects /index.html to /, and a redirected response can't
  // answer a navigation). Every route is the same single-page app.
  const cached = (await caches.match("/", { cacheName: SHELL })) ?? null;
  const network = fetch(req);
  if (!cached) return network;
  const timeout = new Promise<Response>((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS));
  return Promise.race([network.then((r) => (r.ok ? r : cached), () => cached), timeout]);
}

async function cacheFirst(req: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

/** /data/m/<id>.<hash>.json. Keep only the newest file per masechta. */
async function masechtaFile(req: Request, url: URL): Promise<Response> {
  const cache = await caches.open(DATA);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const prefix = url.pathname.slice(0, url.pathname.indexOf(".") + 1); // "/data/m/berakhot."
    for (const old of await cache.keys()) {
      const p = new URL(old.url).pathname;
      if (p.startsWith(prefix) && p !== url.pathname) await cache.delete(old);
    }
  }
  return res;
}

async function staleWhileRevalidate(event: FetchEvent, cacheName: string): Promise<Response> {
  const req = event.request;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(
    async (res) => {
      // The stylesheet <link> is a no-cors request, so its response is opaque (status 0); cache it anyway.
      if (res.ok || res.type === "opaque") await cache.put(req, res.clone());
      return res;
    },
    () => undefined,
  );
  event.waitUntil(fresh);
  if (hit) return hit;
  return (await fresh) ?? Response.error();
}
