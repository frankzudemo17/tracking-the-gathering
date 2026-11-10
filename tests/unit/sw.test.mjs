// Spec P11 Tempo, Kriterien 1–9: sw.js in node:vm mit Attrappen für self, caches, fetch, clients.
// Geprüft wird die ausgelieferte Datei selbst (als Text geladen), kein Nachbau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const SCOPE = 'https://app.test/ttg/';
const SB_VERSION = fs.readFileSync(path.join(ROOT, 'src', 'supabase.js'), 'utf8').match(/supabase-js@([\d.]+)/)[1];

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const typeOf = (p) => TYPES[path.posix.extname(p)] ?? (p.endsWith('/') ? 'text/html' : 'application/octet-stream');
const strip = (u) => u.split('?')[0];
const keyOf = (r) => (typeof r === 'string' ? r : r.url);

/** CacheStorage-Attrappe mit Protokoll (put je Cache, globales match). */
function fakeCaches() {
  const store = new Map();
  const log = [];
  const cache = (name) => {
    const map = new Map();
    return {
      map,
      async match(req, opts = {}) {
        const k = keyOf(req);
        const hit = opts.ignoreSearch ? [...map].find(([x]) => strip(x) === strip(k))?.[1] : map.get(k);
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) { log.push(['put', name, keyOf(req)]); map.set(keyOf(req), res); },
      async keys() { return [...map.keys()].map((url) => ({ url })); },
      async delete(req) { return map.delete(keyOf(req)); },
    };
  };
  return {
    store, log,
    async open(n) { if (!store.has(n)) store.set(n, cache(n)); return store.get(n); },
    async has(n) { return store.has(n); },
    async delete(n) { log.push(['delete', n]); return store.delete(n); },
    async keys() { return [...store.keys()]; },
    async match() { log.push(['global-match']); return undefined; },
  };
}

/**
 * Lädt sw.js. over: Ersetzungen im Quelltext ([alt, neu]); serve(pathOhneQuery, url) ⇒ Response | 'fail'.
 * Liefert Attrappen + dispatch(type, extra) ⇒ { waited, responded }.
 */
function load({ over = [], serve, clients = 1 } = {}) {
  let src = SOURCE;
  for (const [a, b] of over) { assert.ok(src.includes(a), `Ersetzung nicht gefunden: ${a}`); src = src.replace(a, b); }
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0, fetch: [] };
  const caches = fakeCaches();
  const self = {
    location: new URL(SCOPE + 'sw.js'),
    registration: { scope: SCOPE },
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
    skipWaiting: async () => { calls.skipWaiting++; caches.log.push(['skipWaiting']); },
    clients: {
      matchAll: async (o) => { calls.matchAll = o; return Array.from({ length: clients }, (_, i) => ({ id: String(i) })); },
      claim: async () => { calls.claim++; },
    },
  };
  const fetch = async (input, init = {}) => {
    const url = keyOf(input);
    calls.fetch.push({ url, init });
    const p = new URL(url).pathname;
    const res = serve ? serve(p, url) : undefined;
    if (res === 'fail') throw new TypeError('Failed to fetch');
    if (res) return res;
    return new Response(`/* ${p} */ ${p.endsWith('version.js') ? "export const APP_VERSION = '" + version(src) + "';" : ''}`, { status: 200, headers: { 'Content-Type': typeOf(p) } });
  };
  const ctx = vm.createContext({ self, caches, fetch, Response, Request, Headers, URL, TextDecoder, console, Promise, setTimeout });
  vm.runInContext(src + '\n;globalThis.__sw = { VERSION, SHELL, URGENT };', ctx);
  const sw = ctx.__sw;
  async function dispatch(type, extra = {}) {
    const ev = { ...extra, waits: [], responded: undefined };
    ev.waitUntil = (p) => { ev.waits.push(Promise.resolve(p)); };
    ev.respondWith = (p) => { ev.responded = Promise.resolve(p); };
    for (const fn of listeners[type] ?? []) fn(ev);
    const settled = await Promise.allSettled(ev.waits);
    const rejected = settled.find((s) => s.status === 'rejected');
    return { ok: !rejected, error: rejected?.reason, responded: ev.responded, ev };
  }
  return { sw, caches, calls, dispatch, src };
}
const version = (src) => src.match(/const VERSION = 'ttg-(v\d+)'/)[1];
const abs = (e) => new URL(e, SCOPE).href;
const req = (p, o = {}) => ({ url: SCOPE + p, method: 'GET', mode: 'cors', ...o });
const text = async (r) => (await r).text();
const MARK = abs('./__ttg-komplett');

/** Version mit fertigem Precache (Gutfall-install). */
async function installed(opts) {
  const t = load(opts);
  const r = await t.dispatch('install');
  assert.ok(r.ok, `install sollte gelingen: ${r.error}`);
  t.calls.fetch.length = 0;
  t.caches.log.length = 0;
  return t;
}

// ------------------------------------------------------------------ Kriterium 1–3: fetch
test('K1 Cache zuerst: Treffer ⇒ 0 fetch; Inhalt aus fremdem Cache ttg-alt wird nie geliefert; kein globales caches.match', async () => {
  const t = await installed();
  const r = await t.dispatch('fetch', { request: req('src/main.js') });
  assert.match(await text(r.responded), /\/ttg\/src\/main\.js/);
  assert.equal(t.calls.fetch.length, 0);
  (await t.caches.open('ttg-alt')).map.set(SCOPE + 'nicht-in-shell.js', new Response('ALT'));
  const r2 = await t.dispatch('fetch', { request: req('nicht-in-shell.js') });
  assert.doesNotMatch(await text(r2.responded), /ALT/);
  assert.equal(t.calls.fetch.length, 1, 'Fehltreffer geht ans Netz, nicht an ttg-alt');
  assert.ok(!t.caches.log.some((l) => l[0] === 'global-match'));
  assert.ok(!/caches\.match/.test(SOURCE), 'sw.js nennt caches.match');
});

test('K2 kein Laufzeit-Schreiben: Fehltreffer ⇒ genau 1 fetch mit cache no-cache, Schlüsselzahl unverändert', async () => {
  const t = await installed();
  const before = (await (await t.caches.open(t.sw.VERSION)).keys()).length;
  const r = await t.dispatch('fetch', { request: req('neu.js') });
  await r.responded;
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(t.calls.fetch.length, 1);
  assert.equal(t.calls.fetch[0].init.cache, 'no-cache');
  assert.equal((await (await t.caches.open(t.sw.VERSION)).keys()).length, before);
  assert.deepEqual(t.caches.log.filter((l) => l[0] === 'put'), []);
});

test('K3 Seitenaufruf ⇒ index.html aus dem Versions-Cache (Query, Unterpfad); Skript/CSS/Schrift nie index.html', async () => {
  let off = false;
  const t = await installed({ serve: () => (off ? 'fail' : undefined) });
  off = true;
  for (const p of ['?reset=1&code=abc#/passwort-neu', 'irgend/wo', '']) {
    const r = await t.dispatch('fetch', { request: req(p, { mode: 'navigate' }) });
    assert.match(await text(r.responded), /\/ttg\/index\.html/, `navigate ${p}`);
  }
  assert.equal(t.calls.fetch.length, 0);
  for (const p of ['src/fehlt.js', 'src/styles/fehlt.css', 'assets/fonts/fehlt.woff2']) {
    const r = await t.dispatch('fetch', { request: req(p) });
    const res = await r.responded.catch((e) => e);
    assert.ok(res instanceof Error || res.type === 'error', `${p} ⇒ Fehlerantwort`);
  }
});

// ------------------------------------------------------------------ Kriterium 4, 5, 9: install
const BAD = {
  '404': (p) => (p.endsWith('/src/lib/dom.js') ? new Response('404', { status: 404 }) : undefined),
  'Netzfehler': (p) => (p.endsWith('/src/lib/dom.js') ? 'fail' : undefined),
  '200 text/html für .js': (p) => (p.endsWith('/src/lib/dom.js') ? new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) : undefined),
  'redirected': (p) => {
    if (!p.endsWith('/src/lib/dom.js')) return undefined;
    const r = new Response('x', { headers: { 'Content-Type': 'text/javascript' } });
    Object.defineProperty(r, 'redirected', { value: true });
    return r;
  },
  'Abbruch im Rumpf': (p) => {
    if (!p.endsWith('/src/lib/dom.js')) return undefined;
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('export const')); c.error(new TypeError('network error')); } });
    return new Response(body, { headers: { 'Content-Type': 'text/javascript' } });
  },
  'src/version.js ohne passende Nummer': (p) => (p.endsWith('/src/version.js') ? new Response("export const APP_VERSION = 'v1';", { headers: { 'Content-Type': 'text/javascript' } }) : undefined),
};
for (const [name, serve] of Object.entries(BAD)) {
  test(`K4 install ganz oder gar nicht: ${name} ⇒ verworfen, kein skipWaiting, kein neuer Cache, alter unverändert`, async () => {
    for (const urgent of [false, true]) {
      const t = load({ serve, over: urgent ? [['const URGENT = false;', 'const URGENT = true;']] : [] });
      const old = await t.caches.open('ttg-v1');
      await old.put(abs('./src/main.js'), new Response('ALT'));
      t.caches.log.length = 0;
      const r = await t.dispatch('install');
      assert.equal(r.ok, false, 'install verworfen');
      assert.equal(t.calls.skipWaiting, 0, `skipWaiting (URGENT=${urgent})`);
      assert.equal(await t.caches.has(t.sw.VERSION), false, 'kein Cache mit neuem Namen');
      assert.deepEqual([...(await t.caches.keys())], ['ttg-v1']);
      assert.equal(await (await old.match(abs('./src/main.js'))).text(), 'ALT');
      assert.ok(!t.caches.log.some((l) => l[0] === 'put' && l[1] === 'ttg-v1'));
    }
  });
}

test('K4 Gutfall: jede Anfrage cache reload + ?v=VERSION, gespeichert ohne Query, SHELL+1 Schlüssel, Marke zuletzt', async () => {
  const t = load();
  const r = await t.dispatch('install');
  assert.ok(r.ok, String(r.error));
  const { VERSION, SHELL } = t.sw;
  assert.equal(t.calls.fetch.length, SHELL.length);
  for (const f of t.calls.fetch) {
    assert.equal(f.init.cache, 'reload', f.url);
    assert.equal(new URL(f.url).searchParams.get('v'), VERSION, f.url);
  }
  const keys = (await (await t.caches.open(VERSION)).keys()).map((k) => k.url);
  assert.equal(keys.length, SHELL.length + 1);
  assert.deepEqual(new Set(keys), new Set([...SHELL.map(abs), MARK]));
  assert.ok(keys.every((k) => !k.includes('?')));
  const puts = t.caches.log.filter((l) => l[0] === 'put');
  assert.deepEqual(puts.at(-1), ['put', VERSION, MARK], 'Marke ist der letzte Schreibvorgang');
  assert.equal(t.calls.skipWaiting, 0, 'K5: URGENT = false ⇒ kein skipWaiting');
});

test('K4 gleicher Name: Cache VERSION mit Marke ⇒ verworfen, 0 fetch, unverändert; ohne Marke ⇒ neu aufgebaut', async () => {
  const t = load();
  const c = await t.caches.open(t.sw.VERSION);
  await c.put(abs('./src/main.js'), new Response('LAUFEND'));
  await c.put(MARK, new Response(''));
  t.caches.log.length = 0;
  const r = await t.dispatch('install');
  assert.equal(r.ok, false);
  assert.equal(t.calls.fetch.length, 0);
  assert.equal(await (await c.match(abs('./src/main.js'))).text(), 'LAUFEND');
  assert.equal((await c.keys()).length, 2);
  assert.deepEqual(t.caches.log, []);

  const u = load();
  const rest = await u.caches.open(u.sw.VERSION);
  await rest.put(abs('./src/main.js'), new Response('REST'));
  await rest.put(abs('./laufzeit-rest.js'), new Response('REST'));
  const r2 = await u.dispatch('install');
  assert.ok(r2.ok, String(r2.error));
  const now = await u.caches.open(u.sw.VERSION);
  const keys = (await now.keys()).map((k) => k.url);
  assert.equal(keys.length, u.sw.SHELL.length + 1);
  assert.ok(!keys.includes(abs('./laufzeit-rest.js')));
  assert.doesNotMatch(await (await now.match(abs('./src/main.js'))).text(), /REST/);
});

test('K5 die neue Version wartet: activate ruft clients.claim nicht; sw.js nennt clients.claim nicht', async () => {
  const t = await installed();
  const r = await t.dispatch('activate');
  assert.ok(r.ok);
  assert.equal(t.calls.claim, 0);
  assert.equal(t.calls.skipWaiting, 0);
  assert.ok(!/clients\.claim/.test(SOURCE));
});

test('K9 Notfall-Schalter: URGENT = true ⇒ skipWaiting nach vollständigem Precache; Branch-Stand URGENT = false', async () => {
  assert.match(SOURCE, /^const URGENT = false;$/m);
  const t = load({ over: [['const URGENT = false;', 'const URGENT = true;']] });
  const r = await t.dispatch('install');
  assert.ok(r.ok);
  assert.equal(t.calls.skipWaiting, 1);
  const i = t.caches.log.findIndex((l) => l[0] === 'skipWaiting');
  const m = t.caches.log.findIndex((l) => l[0] === 'put' && l[2] === MARK);
  assert.ok(m >= 0 && i > m, 'skipWaiting erst nach der Marke');
});

// ------------------------------------------------------------------ Kriterium 6, 7
test('K6 Übernahme nur auf Nachricht und nur allein', async () => {
  const one = load({ clients: 1 });
  await one.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(one.calls.skipWaiting, 1);
  assert.deepEqual({ ...one.calls.matchAll }, { type: 'window', includeUncontrolled: true });
  const two = load({ clients: 2 });
  await two.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(two.calls.skipWaiting, 0);
  const other = load({ clients: 1 });
  await other.dispatch('message', { data: { type: 'ETWAS' } });
  await other.dispatch('message', { data: 'SKIP_WAITING' });
  await other.dispatch('message', { data: null });
  assert.equal(other.calls.skipWaiting, 0);
});

test('K7 activate räumt auf: nur VERSION und der Ext-Cache bleiben', async () => {
  const t = load();
  const ext = `ttg-ext-supabase-${SB_VERSION}`;
  for (const n of ['ttg-v1', 'ttg-alt', t.sw.VERSION, ext]) await t.caches.open(n);
  const r = await t.dispatch('activate');
  assert.ok(r.ok);
  assert.deepEqual((await t.caches.keys()).sort(), [t.sw.VERSION, ext].sort());
});

// ------------------------------------------------------------------ Kriterium 8
test('K8 Fremdes bleibt fremd; esm.sh cache-zuerst im Ext-Cache mit der Fassung aus src/supabase.js', async () => {
  const t = await installed();
  for (const r of [
    { url: 'https://abc.supabase.co/rest/v1/games', method: 'GET', mode: 'cors' },
    { url: 'https://api.scryfall.com/cards/named?exact=x', method: 'GET', mode: 'cors' },
    { url: 'https://cards.scryfall.io/art_crop/x.jpg', method: 'GET', mode: 'no-cors' },
    { url: SCOPE + 'src/main.js', method: 'POST', mode: 'cors' },
  ]) {
    const e = await t.dispatch('fetch', { request: r });
    assert.equal(e.responded, undefined, `${r.method} ${r.url}`);
  }
  assert.equal(t.calls.fetch.length, 0);
  const esm = { url: `https://esm.sh/@supabase/supabase-js@${SB_VERSION}`, method: 'GET', mode: 'cors' };
  const a = await t.dispatch('fetch', { request: esm });
  await (await a.responded).text();
  assert.equal(t.calls.fetch.length, 1);
  const ext = `ttg-ext-supabase-${SB_VERSION}`;
  assert.ok(await t.caches.has(ext), `Ext-Cache ${ext}`);
  const b = await t.dispatch('fetch', { request: esm });
  await (await b.responded).text();
  assert.equal(t.calls.fetch.length, 1, 'zweiter Abruf ohne fetch');
  assert.ok(!(await (await t.caches.open(t.sw.VERSION)).match(esm.url)), 'nicht im Versions-Cache');
  // nur ok-Antworten werden gespeichert
  const u = await installed({ serve: (p) => (p.includes('kaputt') ? new Response('x', { status: 500 }) : undefined) });
  const bad = { url: 'https://esm.sh/kaputt', method: 'GET', mode: 'cors' };
  await (await (await u.dispatch('fetch', { request: bad })).responded).text();
  assert.ok(!(await (await u.caches.open(ext)).match(bad.url)));
});
