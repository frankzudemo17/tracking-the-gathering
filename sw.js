// Service Worker · Etappe 1: App-Shell offline verfügbar.
// Strategie: eigene Dateien „Netz zuerst, sonst Cache“ (so kommen Updates sofort an),
// Google Fonts „Cache zuerst“. Supabase-Anfragen werden nie gecacht.
// Die Ereignis-Warteschlange für Offline-Spiele folgt in Etappe 5/6.
const VERSION = 'ttg-v10';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './src/styles/tokens.css', './src/styles/base.css', './src/styles/components.css',
  './src/main.js', './src/router.js', './src/state.js', './src/supabase.js', './src/config.js',
  './src/i18n/index.js', './src/i18n/de.js', './src/i18n/en.js',
  './src/lib/dom.js', './src/lib/icons.js', './src/lib/ui.js', './src/lib/parts.js', './src/lib/avatar.js', './src/lib/group-actions.js', './src/lib/scryfall.js', './src/lib/decks.js', './src/lib/game-store.js',
  './src/game/engine.js', './src/game/layouts.js', './src/game/rng.js', './src/game/ko.js',
  './assets/icons/logo-light.png', './assets/icons/logo-dark.png', './assets/icons/favicon.png', './assets/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  const cacheFirst = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'esm.sh';
  if (cacheFirst) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
  // alles andere (Supabase, Scryfall …) geht direkt ans Netz
});
