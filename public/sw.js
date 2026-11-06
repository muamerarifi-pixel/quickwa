/* QuickWA service worker — app opens instantly and fully offline.
   v4 fix: the old worker cached "/index.html", which Cloudflare redirects to "/".
   Browsers refuse a redirected response for a page load, so offline start failed.
   Now the page is cached as "/", redirects are cleaned, and the network is given
   only a short time before the cached copy is used. */
const VERSION = 'quickwa-v4.1.0';
const SHELL = '/';
const ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/countries.js',
  '/qrcode.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png'
];

// A response that went through a redirect can't be served for navigation: rebuild it.
async function clean(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await c.put(url, await clean(res));
      } catch (err) { /* one failed file must not break the install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // sync calls always go to the network

  // Pages: try the network briefly (fresh deploys), otherwise the cached app shell.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const net = fetch(req).then(async (res) => {
        if (res && res.ok) { const ok = await clean(res); cache.put(SHELL, ok.clone()); return ok; }
        return res;
      });
      try {
        return await Promise.race([net, timeout(3000)]);
      } catch (err) {
        const hit = await cache.match(SHELL) || await caches.match(SHELL, { ignoreSearch: true });
        if (hit) { net.catch(() => {}); return hit; }
        try { return await net; } catch (err2) {
          return new Response('<meta charset="utf-8"><p style="font:16px system-ui;padding:24px">QuickWA is offline and not cached yet. Open it once with internet.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
      }
    })());
    return;
  }

  // Files: cache first, refresh in the background.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(async (res) => {
      if (res && res.ok) { const ok = await clean(res); cache.put(req, ok.clone()); return ok; }
      return res;
    }).catch(() => hit);
    if (hit) { e.waitUntil(net.then(() => {}, () => {})); return hit; }
    const res = await net;
    return res || new Response('', { status: 504 });
  })());
});
