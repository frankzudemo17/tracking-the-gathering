// Service Worker · Etappe 1: App-Shell offline verfügbar.
// Strategie: eigene Dateien „Netz zuerst, sonst Cache“ (so kommen Updates sofort an),
// dabei am HTTP-Cache vorbei neu prüfen (GitHub Pages liefert max-age=600 — sonst mischen sich
// nach einem Deploy bis zu 10 Minuten lang alte und neue Module),
// esm.sh (supabase-js) „Cache zuerst“. Supabase-Anfragen werden nie gecacht.
// Schriften liegen selbst gehostet unter assets/fonts/ und stehen in der SHELL (offline da).
// Die Ereignis-Warteschlange für Offline-Spiele folgt in Etappe 5/6.
const VERSION = 'ttg-v16';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './src/styles/fonts.css', './src/styles/tokens.css', './src/styles/base.css', './src/styles/components.css',
  './src/styles/setup.css', './src/styles/life.css', './src/styles/dice.css', './src/styles/attack.css', './src/styles/ko.css',
  './assets/fonts/bricolage-grotesque-latin-opsz.woff2', './assets/fonts/geist-latin-wght.woff2', './assets/fonts/unbounded-latin-wght.woff2',
  './src/main.js', './src/router.js', './src/state.js', './src/supabase.js', './src/config.js', './src/version.js',
  './src/i18n/index.js', './src/i18n/de.js', './src/i18n/en.js',
  './src/i18n/de-setup.js', './src/i18n/en-setup.js', './src/i18n/de-life.js', './src/i18n/en-life.js', './src/i18n/de-dice.js', './src/i18n/en-dice.js', './src/i18n/de-attack.js', './src/i18n/en-attack.js', './src/i18n/de-ko.js', './src/i18n/en-ko.js',
  './src/lib/dom.js', './src/lib/icons.js', './src/lib/ui.js', './src/lib/parts.js', './src/lib/avatar.js', './src/lib/group-actions.js', './src/lib/scryfall.js', './src/lib/decks.js', './src/lib/game-store.js', './src/lib/field-color.js', './src/lib/rand.js',
  './src/game/engine.js', './src/game/layouts.js', './src/game/rng.js', './src/game/ko.js',
  './assets/icons/logo-light.png', './assets/icons/logo-dark.png', './assets/icons/favicon.png', './assets/icons/icon-192.png',
  './src/styles/result.css', './src/styles/history.css', './src/styles/board.css', './src/styles/recap.css', './src/styles/stats.css', './src/i18n/de-result.js', './src/i18n/en-result.js', './src/i18n/de-history.js', './src/i18n/en-history.js', './src/i18n/de-board.js', './src/i18n/en-board.js', './src/i18n/de-recap.js', './src/i18n/en-recap.js', './src/i18n/de-stats.js', './src/i18n/en-stats.js', './src/lib/stats.js', './src/lib/history-data.js', './src/lib/data.js', './src/lib/format.js',
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
    const nav = req.mode === 'navigate';
    const cached = () => caches.match(req, { ignoreSearch: true });
    e.respondWith(
      (nav ? fetch(req) : fetch(req, { cache: 'no-cache' })).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; }
        // 404/5xx (z. B. mitten im Deploy): lieber die letzte gute Fassung als eine Fehlerseite
        return cached().then((hit) => hit || res);
      }).catch(() => cached().then((hit) => hit || (nav ? caches.match('./index.html') : null) || Response.error()))
      // index.html nur als Ersatz für Seitenaufrufe — nie als Antwort auf ein Skript, Stylesheet oder Bild
    );
    return;
  }

  const cacheFirst = url.hostname === 'esm.sh';
  if (cacheFirst) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
  // alles andere (Supabase, Scryfall …) geht direkt ans Netz
});
