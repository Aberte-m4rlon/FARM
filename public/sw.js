// ALPASFARM Progressive Web App Service Worker
// Version: 1.0.0
const CACHE_NAME = 'alpasfarm-shell-v1';
const STATIC_CACHE = 'alpasfarm-static-v1';

// Static assets forming the core application shell
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/manifest.json',
  '/alpasfarm-logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/favicon-32.png'
];

// Installation: Cache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }).catch((err) => {
      console.warn('[SW] Pre-caching error (non-fatal):', err);
    })
  );
});

// Activation: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name !== STATIC_CACHE) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Update Listener: Activate when user clicks 'I-update'
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch Interceptor: Caching Strategies & Strict Security Rules
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Non-GET requests (mutations, uploads) always go directly to network
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // Ignore non-http/https schemes (e.g. chrome-extension, blob, data)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // =========================================================================
  // STRICT DATA SECURITY & MULTI-TENANCY RULE:
  // NEVER cache API responses, Supabase calls, Auth tokens, or Private data!
  // =========================================================================
  const isSupabase = url.hostname.includes('supabase.co');
  const isLocalApi = url.pathname.startsWith('/api/');
  const isAuthOrPrivate =
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/storage/v1/');

  if (isSupabase || isLocalApi || isAuthOrPrivate) {
    // Network-only, bypass cache completely
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(
          JSON.stringify({
            error: 'Offline',
            message: 'Walang internet connection. Kailangan ng koneksyon para sa impormasyong ito.'
          }),
          {
            status: 503,
            statusText: 'Service Unavailable (Offline)',
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // 1. Navigation Requests (Page loads / URL routing): Network-First with Cache Fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cachedNavigate = await caches.match(req);
          if (cachedNavigate) return cachedNavigate;
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;
          return caches.match('/');
        })
    );
    return;
  }

  // 2. Static Assets (JS, CSS, Images, Icons, Fonts): Stale-While-Revalidate
  const isStaticAsset =
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/) ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        const fetchPromise = fetch(req)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(req, clone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Default fallback: Network with cache fallback
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
