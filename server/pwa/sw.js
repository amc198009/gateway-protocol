/* Gateway Protocol — service worker
 * ───────────────────────────────────────────────────────────────────────
 * Caches the app shell for offline launch + instant loads, while NEVER
 * caching the dynamic, key-bearing endpoints. The sovereign promise holds:
 * the user's BYOK requests always go straight to the network — they're never
 * stored in the SW cache.
 *
 *   • Shell (cache-first, stale-while-revalidate): /app, three.min.js,
 *     audio-worklet.js, manifest, icons, and Google Fonts.
 *   • Dynamic (network-only, never cached): /byok/*, /api/*, /feed*, /room*,
 *     /version, and every non-GET request.
 * ─────────────────────────────────────────────────────────────────────── */
const CACHE = 'gp-shell-v1';
const SHELL = [
  '/app',
  '/vendor/three.min.js',
  '/audio-worklet.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
// Same-origin paths that must always hit the network (user keys / live state).
const DYNAMIC = [/^\/byok\//, /^\/api\//, /^\/feed/, /^\/room/, /^\/version$/];

self.addEventListener('install', (e) => {
  // Precache the shell, then take over without waiting for old tabs to close.
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  // Drop old cache versions, then control open clients immediately.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never intercept writes
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Dynamic same-origin endpoints: bypass the SW entirely (no caching).
  if (sameOrigin && DYNAMIC.some((re) => re.test(url.pathname))) return;

  // Google Fonts: opportunistic cache-first (cross-origin, but part of the shell).
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
      catch (err) { return hit || Response.error(); }
    }));
    return;
  }

  if (!sameOrigin) return; // leave other cross-origin requests untouched

  // Same-origin shell + assets: serve cache fast, refresh in the background.
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req)
      .then((res) => { if (res.ok) c.put(req, res.clone()); return res; })
      .catch(() => hit);
    return hit || net;
  }));
});
