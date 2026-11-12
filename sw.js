// Service Worker · P11 Tempo: eigene Dateien „Cache zuerst“, nur aus dem einen Versions-Cache.
// - install holt JEDE SHELL-Datei am HTTP-Cache vorbei (cache: 'reload' + ?v=VERSION), prüft alles und
//   schreibt erst dann — ganz oder gar nicht; ein Fehler lässt die laufende Version unangetastet.
// - Die neue Version WARTET. Die Seite (src/lib/sw-update.js) schickt { type: 'SKIP_WAITING' } nur auf
//   ruhigen Routen; der Worker folgt nur, wenn genau ein Fenster offen ist. Im Spiel wird nie neu geladen.
// - Ohne neue VERSION kommt keine Änderung auf installierten Geräten an (tools/release-check.mjs).
// - esm.sh (supabase-js) liegt in einem eigenen Cache je Fassung; Supabase, Scryfall & Co. nie gecacht.
//
// NOTFALL — die ausgelieferte Seite startet nicht mehr und kann die Übernahme nicht auslösen:
//   1. Fehler reparieren.   2. VERSION hochzählen (und src/version.js).   3. URGENT = true setzen.
//   4. Ausliefern: die reparierte Version übernimmt nach vollständigem Precache von selbst.
//   5. Mit der nächsten Version URGENT wieder auf false.
//   Zweite Rückfallebene: ein Abschalt-Worker (ein sw.js, das alle Caches löscht und sich abmeldet).
const VERSION = 'ttg-v40';
const URGENT = false;
// Fassung wie in src/supabase.js:1 — wer sie hebt, hebt den Namen (tests/unit/sw.test.mjs prüft das)
const EXT = 'ttg-ext-supabase-2.118.0';
const DONE = './__ttg-komplett';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './src/styles/fonts.css', './src/styles/tokens.css', './src/styles/base.css', './src/styles/components.css',
  './src/styles/setup.css', './src/styles/life.css', './src/styles/dice.css', './src/styles/attack.css', './src/styles/ko.css', './src/styles/ko-fonts.css',
  './src/styles/decklist.css', './src/styles/live.css', './src/styles/table.css', // Naht P3 (Welle ttg-live-feinschliff-decks)
  './assets/fonts/bricolage-grotesque-latin-opsz.woff2', './assets/fonts/geist-latin-wght.woff2', './assets/fonts/unbounded-latin-wght.woff2',
  './src/main.js', './src/router.js', './src/state.js', './src/supabase.js', './src/config.js', './src/version.js',
  './src/i18n/index.js', './src/i18n/de.js', './src/i18n/en.js',
  './src/i18n/de-setup.js', './src/i18n/en-setup.js', './src/i18n/de-life.js', './src/i18n/en-life.js', './src/i18n/de-dice.js', './src/i18n/en-dice.js', './src/i18n/de-attack.js', './src/i18n/en-attack.js', './src/i18n/de-ko.js', './src/i18n/en-ko.js',
  './src/i18n/de-decklist.js', './src/i18n/en-decklist.js', './src/i18n/de-live.js', './src/i18n/en-live.js', './src/i18n/de-table.js', './src/i18n/en-table.js', // Naht P3
  './src/lib/dom.js', './src/lib/icons.js', './src/lib/ui.js', './src/lib/parts.js', './src/lib/avatar.js', './src/lib/group-actions.js', './src/lib/scryfall.js', './src/lib/decks.js', './src/lib/game-store.js', './src/lib/field-color.js', './src/lib/rand.js',
  './src/lib/prefs.js', // Naht P3 (Stub für P7)
  './src/lib/sw-update.js', // P11 Tempo
  './src/lib/cache.js', // P12 Tempo Seitenwechsel
  './src/game/engine.js', './src/game/layouts.js', './src/game/rng.js', './src/game/ko.js', './src/game/dice.js',
  './assets/icons/logo.png', './assets/icons/favicon.png', './assets/icons/icon-192.png',
  './src/styles/result.css', './src/styles/history.css', './src/styles/board.css', './src/styles/recap.css', './src/styles/stats.css', './src/i18n/de-result.js', './src/i18n/en-result.js', './src/i18n/de-history.js', './src/i18n/en-history.js', './src/i18n/de-board.js', './src/i18n/en-board.js', './src/i18n/de-recap.js', './src/i18n/en-recap.js', './src/i18n/de-stats.js', './src/i18n/en-stats.js', './src/lib/stats.js', './src/lib/history-data.js', './src/lib/data.js', './src/lib/format.js',
  // P11 Tempo: Gate B4 verlangt jede Datei unter src/**, jeden Verweis aus index.html und jede url() aus den Stylesheets
  './assets/icons/apple-touch-icon.png',
  './src/views/add-deck.js', './src/views/add-player.js', './src/views/attack-ui.js', './src/views/attack.js', './src/views/board-ui.js', './src/views/board.js',
  './src/views/bracket-hint.js', './src/views/deck-list.js', './src/views/deck.js', './src/views/dice.js', './src/views/forgot.js',
  './src/views/game-detail.js', './src/views/group-delete.js', './src/views/groups.js', './src/views/history-ui.js', './src/views/history.js', './src/views/join.js',
  './src/views/ko-art.js', './src/views/ko.js', './src/views/legal.js', './src/views/life-ui.js', './src/views/life.js', './src/views/login.js', './src/views/member-remove.js',
  './src/views/newpass.js', './src/views/profile.js', './src/views/recap-card.js', './src/views/recap.js', './src/views/register.js', './src/views/result-ui.js',
  './src/views/result.js', './src/views/settings-account.js', './src/views/settings-rules.js', './src/views/settings-table.js', './src/views/settings.js', './src/views/setup.js',
  './src/views/soon.js', './src/views/start.js', './src/views/stats-ui.js', './src/views/welcome.js',
  './src/decks/bracket.js', './src/decks/cards.js', './src/decks/manabox.js', './src/decks/spellbook.js',
  './src/views/admin.js', './src/zugang/invite.js', './src/zugang/invite-ui.js', './src/zugang/limits.js', './src/zugang/qr.js', './src/zugang/vendor/qrcode-generator.mjs', // P9b Zugang-UI
  './assets/fonts/ko/bangers/bangers-latin-400-normal.woff2', './assets/fonts/ko/bangers/bangers-latin-ext-400-normal.woff2',
  './assets/fonts/ko/cinzel/cinzel-latin-400-normal.woff2', './assets/fonts/ko/cinzel/cinzel-latin-700-normal.woff2',
  './assets/fonts/ko/cinzel/cinzel-latin-ext-400-normal.woff2', './assets/fonts/ko/cinzel/cinzel-latin-ext-700-normal.woff2',
  './assets/fonts/ko/noto-sans-jp/noto-sans-jp-118-900-normal.woff2', './assets/fonts/ko/noto-sans-jp/noto-sans-jp-119-900-normal.woff2',
  './assets/fonts/ko/press-start-2p/press-start-2p-latin-400-normal.woff2', './assets/fonts/ko/press-start-2p/press-start-2p-latin-ext-400-normal.woff2',
];

const abs = (u) => new URL(u, self.location.href).href;
const TEXT_OK = (entry) => entry === './' || entry.endsWith('.html');

/** Eine SHELL-Datei holen und prüfen; der Rumpf wird ganz gelesen (ein Abbruch zeigt sich erst hier). */
async function grab(entry) {
  const url = abs(entry);
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(VERSION), { cache: 'reload' });
  if (!res.ok || res.redirected) throw new Error(`Precache ${entry}: ${res.status}${res.redirected ? ' umgeleitet' : ''}`);
  const type = res.headers.get('Content-Type') || '';
  if (!TEXT_OK(entry) && /text\/html/i.test(type)) throw new Error(`Precache ${entry}: text/html statt Datei`);
  const body = await res.arrayBuffer();
  if (entry === './src/version.js') {
    const num = VERSION.replace(/^ttg-/, '');
    if (!new TextDecoder().decode(body).includes(`'${num}'`)) throw new Error(`Precache: src/version.js passt nicht zu ${VERSION}`);
  }
  return [url, new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })];
}

async function precache() {
  const mark = abs(DONE);
  if (await caches.has(VERSION)) {
    const existing = await caches.open(VERSION);
    // Vollständiger Cache unter diesem Namen: aus ihm laden offene Seiten gerade — nie überschreiben.
    if (await existing.match(mark)) throw new Error(`${VERSION} ist schon vollständig installiert`);
    await caches.delete(VERSION); // Rest ohne Marke (abgebrochen oder Laufzeit-Cache des alten Workers)
  }
  let files;
  try {
    files = await Promise.all(SHELL.map(grab));
    const cache = await caches.open(VERSION);
    await Promise.all(files.map(([url, res]) => cache.put(url, res)));
    await cache.put(mark, new Response(''));
  } catch (e) {
    await caches.delete(VERSION);
    throw e;
  }
  if (URGENT) await self.skipWaiting();
}

self.addEventListener('install', (e) => { e.waitUntil(precache()); });

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== EXT).map((k) => caches.delete(k)))));
});

self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'SKIP_WAITING') return;
  // Bei zwei offenen Fenstern weiter warten: das andere könnte mitten im Spiel sein.
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => (list.length === 1 ? self.skipWaiting() : undefined)));
});

async function own(req, url) {
  const cache = await caches.open(VERSION);
  const nav = req.mode === 'navigate';
  const hit = await cache.match(nav ? abs('./index.html') : url.origin + url.pathname);
  if (hit) return hit;
  // Fehltreffer: Netz, nichts speichern (der Versions-Cache enthält genau, was install hineingelegt hat).
  // Ein Skript, Stylesheet, Bild oder eine Schrift wird nie mit index.html beantwortet.
  return fetch(req, { cache: 'no-cache' });
}

async function ext(req) {
  const cache = await caches.open(EXT);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req.url, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(own(req, url)); return; }
  if (url.hostname === 'esm.sh') e.respondWith(ext(req));
  // alles andere (Supabase, Scryfall …) geht direkt ans Netz
});
