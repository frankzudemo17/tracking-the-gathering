// Spec P11 Tempo, Kriterien 10–14: Übernahme-Logik der Seite (src/lib/sw-update.js) mit Attrappen,
// Routen-Kennzeichen in src/main.js (als Text gelesen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, shouldRegister, setupSwUpdate } from '../../src/lib/sw-update.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------------------ Kriterium 10
test('K10 decide: Wahrheitstafel', () => {
  const base = { waiting: true, stale: false, boot: false, searchAtLoad: false, fromSwap: true, toSwap: true, guardRecent: false };
  const d = (o) => decide({ ...base, ...o });
  assert.equal(d({ waiting: false }), 'go', 'nichts wartet');
  assert.equal(d({}), 'swap', 'wartet, beide ruhig');
  assert.equal(d({ toSwap: false }), 'go', 'Ziel nicht ruhig');
  assert.equal(d({ fromSwap: false }), 'go', 'Herkunft nicht ruhig');
  assert.equal(d({ boot: true, fromSwap: false }), 'swap', 'Start ohne Query, Ziel ruhig');
  assert.equal(d({ boot: true, fromSwap: false, searchAtLoad: true }), 'go', 'Start mit Query');
  assert.equal(d({ boot: true, toSwap: false }), 'go', 'Start, Ziel nicht ruhig');
  for (const o of [{}, { toSwap: false }, { fromSwap: false }, { waiting: false }, { boot: true, searchAtLoad: true }]) {
    assert.equal(d({ ...o, stale: true }), 'reload', `stale auf jeder Route ${JSON.stringify(o)}`);
  }
  for (const o of [{}, { stale: true }, { boot: true }]) assert.equal(d({ ...o, guardRecent: true }), 'go', 'guardRecent schlägt alles');
});

// ------------------------------------------------------------------ Kriterium 13
test('K13 shouldRegister: https immer, localhost nur mit Schalter, fremder http-Host nie', () => {
  assert.equal(shouldRegister({ protocol: 'https:', hostname: 'frankzudemo17.github.io', flag: null }), true);
  assert.equal(shouldRegister({ protocol: 'http:', hostname: 'localhost', flag: null }), false);
  assert.equal(shouldRegister({ protocol: 'http:', hostname: '127.0.0.1', flag: 'off' }), false);
  assert.equal(shouldRegister({ protocol: 'http:', hostname: 'localhost', flag: 'on' }), true);
  assert.equal(shouldRegister({ protocol: 'http:', hostname: '127.0.0.1', flag: 'on' }), true);
  assert.equal(shouldRegister({ protocol: 'http:', hostname: 'example.org', flag: 'on' }), false);
});

// ------------------------------------------------------------------ Attrappen für Kriterium 12, 14
function world({ controller = true, waiting = true, search = '', protocol = 'https:', hostname = 'app.test', flag = null, store = new Map() } = {}) {
  const log = [];
  const timers = [];
  let clock = 1_000_000;
  const listeners = {};
  const docListeners = {};
  const reg = {
    waiting: waiting ? { postMessage: (m) => log.push(['post', m]) } : null,
    update: async () => { log.push(['update']); },
  };
  const container = {
    controller: controller ? {} : null,
    register: async (url, opts) => { log.push(['register', url, opts]); return reg; },
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
  };
  const session = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const location = { search, protocol, hostname, reload: () => log.push(['reload']) };
  const document = { visibilityState: 'visible', addEventListener: (t, fn) => { (docListeners[t] ??= []).push(fn); } };
  const next = setupSwUpdate({
    container, location, document, storage: () => session, flag: () => flag,
    now: () => clock, timer: (fn, ms) => timers.push({ at: clock + ms, fn }),
  });
  return {
    next, log, reg, store, document, container,
    tick: async () => { await new Promise((r) => setTimeout(r, 0)); },
    advance: (ms) => { clock += ms; for (const t of timers.splice(0)) { if (t.at <= clock) t.fn(); else timers.push(t); } },
    controllerchange: () => { for (const fn of listeners.controllerchange ?? []) fn(); },
    visible: (state = 'visible') => { document.visibilityState = state; for (const fn of docListeners.visibilitychange ?? []) fn(); },
    count: (k) => log.filter((l) => l[0] === k).length,
  };
}

// ------------------------------------------------------------------ Kriterium 12
test('K12 swap: genau eine Nachricht an registration.waiting, nach controllerchange genau ein reload', async () => {
  const w = world();
  await w.tick();
  assert.deepEqual(w.log[0], ['register', './sw.js', { updateViaCache: 'none' }]);
  const r = w.next(true); // Start ohne Query, Ziel ruhig
  assert.ok(r instanceof Promise, 'swap ⇒ Promise');
  assert.equal(w.count('post'), 1);
  assert.deepEqual(w.log.find((l) => l[0] === 'post')[1], { type: 'SKIP_WAITING' });
  w.controllerchange();
  assert.equal(await r, 'reload');
  assert.equal(w.count('reload'), 1);
  w.controllerchange();
  assert.equal(w.count('reload'), 1, 'kein zweites reload');
  assert.ok(Number(w.store.get('ttg.swap')) > 0, 'Merker ttg.swap gesetzt');
});

test('K12 kein controllerchange binnen 4 s ⇒ weiter, kein reload; spätes controllerchange ⇒ stale', async () => {
  const w = world();
  await w.tick();
  const r = w.next(true);
  w.advance(3999);
  w.advance(1);
  assert.equal(await r, 'go');
  assert.equal(w.count('reload'), 0);
  w.controllerchange(); // spät
  assert.equal(w.count('reload'), 0, 'mitten in einer Ansicht nie');
  w.advance(30_000);
  assert.equal(w.next(false), 'reload', 'stale ⇒ reload beim nächsten Routenwechsel, auch auf nicht ruhiger Route');
  assert.equal(w.count('reload'), 1);
});

test('K12 controllerchange ohne Controller beim Start ⇒ ignoriert', async () => {
  const w = world({ controller: false, waiting: false });
  await w.tick();
  w.controllerchange();
  assert.equal(w.next(true), 'go');
  assert.equal(w.next(false), 'go');
  assert.equal(w.count('reload'), 0);
});

test('K12 Schleifenschutz: zweiter Versuch binnen 30 s ⇒ nichts (Merker ttg.swap)', async () => {
  const store = new Map();
  const w = world({ store });
  await w.tick();
  const r = w.next(true);
  w.advance(4000);
  assert.equal(await r, 'go');
  w.advance(10_000);
  assert.equal(w.next(true), 'go', 'zweiter Versuch binnen 30 s');
  assert.equal(w.count('post'), 1);
  // auch eine frisch geladene Seite (gleicher sessionStorage) hält sich daran
  const v = world({ store });
  await v.tick();
  assert.equal(v.next(true), 'go');
  assert.equal(v.count('post'), 0);
});

test('K12 Herkunft zählt: Start auf nicht ruhiger Route, dann ruhig ⇒ go; dann ruhig → ruhig ⇒ swap', async () => {
  const w = world();
  await w.tick();
  assert.equal(w.next(false), 'go', 'Start auf /spiel/…');
  assert.equal(w.next(true), 'go', '/spiel/… → /start: Herkunft nicht ruhig');
  assert.ok(w.next(true) instanceof Promise, '/start → /historie');
});

test('K12 Start mit Query (Mail-Link) ⇒ keine Übernahme beim ersten Zeichnen', async () => {
  const w = world({ search: '?reset=1&code=abc' });
  await w.tick();
  assert.equal(w.next(true), 'go');
  assert.equal(w.count('post'), 0);
});

test('K12/K15 Normalfall ohne wartende Version ⇒ synchron "go", kein Merker', async () => {
  const w = world({ waiting: false });
  await w.tick();
  for (const s of [true, true, false, true]) assert.equal(w.next(s), 'go');
  assert.equal(w.store.has('ttg.swap'), false);
});

test('K12 sessionStorage nicht nutzbar ⇒ nie swap/reload (Schutz greift)', async () => {
  const log = [];
  const next = setupSwUpdate({
    container: { controller: {}, register: async () => ({ waiting: { postMessage: () => log.push('post') }, update: async () => {} }), addEventListener() {} },
    location: { search: '', protocol: 'https:', hostname: 'app.test', reload: () => log.push('reload') },
    document: { visibilityState: 'visible', addEventListener() {} },
    storage: () => { throw new Error('SecurityError'); }, flag: () => null,
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(next(true), 'go');
  assert.deepEqual(log, []);
});

test('K13 lokal ohne Schalter: keine Registrierung; ohne serviceWorker-Container: immer go', async () => {
  const w = world({ protocol: 'http:', hostname: 'localhost' });
  await w.tick();
  assert.equal(w.count('register'), 0);
  assert.equal(w.next(true), 'go', 'ohne Registrierung keine wartende Version');
  const on = world({ protocol: 'http:', hostname: 'localhost', flag: 'on' });
  await on.tick();
  assert.equal(on.count('register'), 1);
  const none = setupSwUpdate({ container: undefined, location: { search: '', protocol: 'http:', hostname: 'x' }, document: { addEventListener() {} }, storage: () => null, flag: () => null });
  assert.equal(none(true), 'go');
});

// ------------------------------------------------------------------ Kriterium 14
test('K14 Update-Suche: sichtbar ⇒ registration.update(); zweimal binnen 60 s ⇒ einmal; hidden ⇒ keiner', async () => {
  const w = world();
  await w.tick();
  w.visible('hidden');
  assert.equal(w.count('update'), 0);
  w.visible();
  assert.equal(w.count('update'), 1);
  w.advance(59_000);
  w.visible();
  assert.equal(w.count('update'), 1, 'binnen 60 s');
  w.advance(1_000);
  w.visible();
  assert.equal(w.count('update'), 2);
});

// ------------------------------------------------------------------ Kriterium 11
// Ruhige Routen laut Spec E3. /historie und /rangliste fehlen hier bewusst: tests/unit/naehte-e45.test.mjs
// (K1 „Naht-Block“) vergleicht ihre Optionen wörtlich, bestehende Tests sind gesperrt ⇒ Entscheid
// Dirigent (Bericht P11, Abweichung A1). Ohne Kennzeichen halten sie — der sichere Normalfall.
const QUIET = ['/login', '/start', '/historie', '/rangliste', '/profil', '/profil/:memberId', '/gruppen', '/einstellungen', '/einstellungen/rechtliches', '/datenschutz'];
const HELD = ['/spiel/:id', '/spiel/:id/ende', '/spielen', '/spiel-neu', '/spieler-neu', '/deck-neu/:memberId', '/beitreten', '/beitreten/:code',
  '/code/:code', '/passwort-neu', '/registrieren', '/passwort-vergessen', '/historie', '/rangliste'];

test('K11 swap: true tragen genau die ruhigen Routen; ausdrücklich nicht die haltenden', () => {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const routes = [...text.matchAll(/route\(\s*'([^']+)'\s*,\s*v\([^)]*\)\s*(?:,\s*(\{[^}]*\}))?\s*\)/g)].map((m) => ({ pattern: m[1], opts: m[2] ?? '' }));
  assert.ok(routes.length >= 25, 'Routen gefunden');
  const flagged = routes.filter((r) => /\bswap:\s*true\b/.test(r.opts)).map((r) => r.pattern).sort();
  assert.deepEqual(flagged, [...QUIET].sort());
  for (const p of HELD) assert.ok(routes.some((r) => r.pattern === p), `Route ${p} existiert`);
  assert.equal((text.match(/\bswap:/g) || []).length, QUIET.length, 'kein swap: außerhalb der Routen-Optionen');
});
