// Spec P12 Vertrag src/lib/cache.js: Tabelle U1–U14 (+ Zusätze Z1–Z3).
// Ladungen mit von Hand aufgelösten Promises; `now` eingespritzt. Modul je Fall per import() ⇒ am
// Start-main (Datei fehlt) schlägt jeder Fall einzeln fehl.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/lib/cache.js');

/** Ladung, die von Hand aufgelöst oder verworfen wird; zählt ihre Aufrufe. */
function manual() {
  const runs = [];
  const fn = () => new Promise((resolve, reject) => { runs.push({ resolve, reject }); });
  return { fn, runs, get calls() { return runs.length; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function clock(t = 1000) { const c = { t, now: () => c.t }; return c; }

test('U1 cacheKey setzt Konto|Gruppe|Name zusammen', async () => {
  const { cacheKey } = await load();
  assert.equal(cacheKey('a', 'g', 'group'), 'a|g|group');
});

test('U2 cacheKey ohne Konto oder Gruppe ⇒ null', async () => {
  const { cacheKey } = await load();
  assert.equal(cacheKey(null, 'g', 'x'), null);
  assert.equal(cacheKey('a', '', 'x'), null);
  assert.equal(cacheKey(undefined, undefined, 'x'), null);
});

test('U3 zwei gleichzeitige load ⇒ Ladung einmal, derselbe Wert', async () => {
  const { createCache } = await load();
  const c = createCache(); const L = manual();
  const p1 = c.load('k', L.fn); const p2 = c.load('k', L.fn);
  assert.equal(L.calls, 1);
  L.runs[0].resolve({ v: 1 });
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a, b);
  assert.deepEqual(a, { v: 1 });
});

test('U4 load nach Erfolg ⇒ keine neue Ladung; peek mit at = now()', async () => {
  const { createCache } = await load();
  const ck = clock(5000); const c = createCache({ now: ck.now });
  const L = manual();
  const p = c.load('k', L.fn); L.runs[0].resolve('wert'); await p;
  ck.t = 9000;
  assert.equal(await c.load('k', L.fn), 'wert');
  assert.equal(L.calls, 1);
  assert.deepEqual(c.peek('k'), { value: 'wert', at: 5000, failed: false });
});

test('U5 force bei vorhandenem Wert ⇒ läuft; währenddessen alter Wert; danach neuer Wert und neues at', async () => {
  const { createCache } = await load();
  const ck = clock(1000); const c = createCache({ now: ck.now });
  await c.load('k', () => 'alt');
  const L2 = manual();
  ck.t = 2000;
  const p = c.load('k', L2.fn, { force: true });
  assert.equal(L2.calls, 1);
  assert.equal(c.peek('k').value, 'alt');
  L2.runs[0].resolve('neu');
  assert.equal(await p, 'neu');
  assert.deepEqual(c.peek('k'), { value: 'neu', at: 2000, failed: false });
});

test('U6 Ladung wirft ohne Wert ⇒ Promise wirft, nichts bleibt, nächstes load lädt wieder', async () => {
  const { createCache } = await load();
  const c = createCache(); const L = manual();
  const p = c.load('k', L.fn);
  L.runs[0].reject(new Error('netz'));
  await assert.rejects(p, /netz/);
  assert.equal(c.peek('k'), undefined);
  assert.ok(!c.keys().includes('k'));
  c.load('k', L.fn).catch(() => {});
  assert.equal(L.calls, 2);
});

test('U7 force wirft bei vorhandenem Wert ⇒ alter Wert, altes at, failed: true', async () => {
  const { createCache } = await load();
  const ck = clock(1000); const c = createCache({ now: ck.now });
  await c.load('k', () => 'alt');
  ck.t = 7000;
  await assert.rejects(c.load('k', () => Promise.reject(new Error('netz')), { force: true }), /netz/);
  assert.deepEqual(c.peek('k'), { value: 'alt', at: 1000, failed: true });
});

test('U8 drop während einer Ladung ⇒ Promise liefert, peek bleibt leer', async () => {
  const { createCache } = await load();
  const c = createCache(); const L = manual();
  const p = c.load('k', L.fn);
  assert.equal(c.drop('k'), 1);
  L.runs[0].resolve('spät');
  assert.equal(await p, 'spät');
  assert.equal(c.peek('k'), undefined);
});

test('U9 clear während einer Ladung ⇒ peek leer, keys leer', async () => {
  const { createCache } = await load();
  const c = createCache(); const L = manual();
  const p = c.load('k', L.fn);
  c.clear();
  L.runs[0].resolve('spät');
  await p;
  assert.equal(c.peek('k'), undefined);
  assert.deepEqual(c.keys(), []);
});

test('U10 ältere Ladung, die nach der jüngeren (force) ankommt, schreibt nicht', async () => {
  const { createCache } = await load();
  const c = createCache(); const LA = manual(); const LB = manual();
  const pa = c.load('k', LA.fn);
  const pb = c.load('k', LB.fn, { force: true });
  LB.runs[0].resolve('B'); await pb;
  LA.runs[0].resolve('A'); await pa;
  assert.equal(c.peek('k').value, 'B');
});

test('U11 load(null) ⇒ Ladung jedes Mal, nichts gemerkt', async () => {
  const { createCache } = await load();
  const c = createCache(); let n = 0;
  await c.load(null, () => ++n);
  await c.load(null, () => ++n);
  assert.equal(n, 2);
  assert.deepEqual(c.keys(), []);
});

test('U12 drop mit Funktion je Gruppe', async () => {
  const { createCache } = await load();
  const c = createCache();
  for (const k of ['a|g1|group', 'a|g1|page:start', 'a|g2|group']) await c.load(k, () => k);
  assert.equal(c.drop((p) => p.group === 'g1'), 2);
  assert.deepEqual(c.keys(), ['a|g2|group']);
});

test('U13 nach gescheitertem Auffrischen: erfolgreiches force ⇒ failed: false, neues at', async () => {
  const { createCache } = await load();
  const ck = clock(1000); const c = createCache({ now: ck.now });
  await c.load('k', () => 'alt');
  await c.load('k', () => Promise.reject(new Error('netz')), { force: true }).catch(() => {});
  ck.t = 3000;
  await c.load('k', () => 'neu', { force: true });
  assert.deepEqual(c.peek('k'), { value: 'neu', at: 3000, failed: false });
});

test('U14 drop aller page:*-Einträge lässt group stehen', async () => {
  const { createCache } = await load();
  const c = createCache();
  for (const k of ['a|g|group', 'a|g|page:start', 'a|g|page:profil']) await c.load(k, () => k);
  assert.equal(c.drop((p) => p.name.startsWith('page:')), 2);
  assert.deepEqual(c.keys(), ['a|g|group']);
});

test('Z1 pending: wahr nur während einer Ladung', async () => {
  const { createCache } = await load();
  const c = createCache(); const L = manual();
  assert.equal(c.pending('k'), false);
  assert.equal(c.pending(null), false);
  const p = c.load('k', L.fn);
  assert.equal(c.pending('k'), true);
  L.runs[0].resolve(1); await p;
  assert.equal(c.pending('k'), false);
});

test('Z2 nach drop/clear startet das nächste load eine neue Ladung, die schreibt', async () => {
  const { createCache } = await load();
  const c = createCache(); const L = manual();
  const p1 = c.load('k', L.fn);
  c.drop('k');
  const p2 = c.load('k', L.fn);
  assert.equal(L.calls, 2);
  L.runs[1].resolve('neu'); await p2;
  L.runs[0].resolve('alt'); await p1;
  assert.equal(c.peek('k').value, 'neu');
  const p3 = c.load('j', L.fn); c.clear(); const p4 = c.load('j', L.fn);
  L.runs[3].resolve('j-neu'); L.runs[2].resolve('j-alt'); await Promise.all([p3, p4]);
  assert.equal(c.peek('j').value, 'j-neu');
});

test('Z3 ältere Ladung scheitert nach der jüngeren ⇒ kein failed', async () => {
  const { createCache } = await load();
  const c = createCache(); const LA = manual(); const LB = manual();
  const pa = c.load('k', LA.fn);
  const pb = c.load('k', LB.fn, { force: true });
  LB.runs[0].resolve('B'); await pb;
  LA.runs[0].reject(new Error('spät')); await pa.catch(() => {});
  await tick();
  assert.deepEqual(c.peek('k'), { value: 'B', at: c.peek('k').at, failed: false });
});

test('Z4 pageCache ist eine Instanz mit leerem Start; GROUP_MAX_AGE_MS = 60 000', async () => {
  const { pageCache, GROUP_MAX_AGE_MS } = await load();
  assert.equal(typeof pageCache.load, 'function');
  assert.equal(GROUP_MAX_AGE_MS, 60000);
});

// ---------------------------------------------------------------------------
// Spec P6 Vertrag (Spiegel in den Gerätespeicher): C1–C8. Speicher-Attrappe zeichnet Aufrufe auf.
function fakeStore() {
  const s = { m: 0, g: 0, calls: [] };
  return Object.assign(s, {
    mark: () => s.m, gen: () => s.g,
    put: (key, value, at, r) => { s.calls.push(['put', key, value, at, r]); },
    del: (keys) => { s.calls.push(['del', keys]); },
    clear: () => { s.calls.push(['clear']); },
    of: (k) => s.calls.filter((c) => c[0] === k),
  });
}

test('C1 seed legt Eintrag an, ruft store.put nicht', async () => {
  const { createCache } = await load();
  const st = fakeStore(); const c = createCache({ store: st });
  c.seed('k', { v: 1 }, 7);
  assert.deepEqual(c.peek('k'), { value: { v: 1 }, at: 7, failed: false });
  assert.equal(st.of('put').length, 0);
});

test('C2 seed auf vorhandenen Wert bzw. laufende Ladung ändert nichts', async () => {
  const { createCache } = await load();
  const k = clock(); const c = createCache({ now: k.now }); const L = manual();
  await c.load('a', () => 'frisch');
  c.seed('a', 'alt', 1);
  assert.deepEqual(c.peek('a'), { value: 'frisch', at: 1000, failed: false });
  const p = c.load('b', L.fn);
  c.seed('b', 'alt', 1);
  assert.equal(c.peek('b'), undefined);
  L.runs[0].resolve('neu');
  assert.equal(await p, 'neu');
  assert.equal(c.peek('b').value, 'neu');
});

test('C3 erfolgreiche Ladung ⇒ store.put genau einmal mit mark/gen vom Beginn', async () => {
  const { createCache } = await load();
  const k = clock(5000); const st = fakeStore(); const c = createCache({ now: k.now, store: st }); const L = manual();
  st.m = 3; st.g = 2;
  const p = c.load('k', L.fn);
  st.m = 4; st.g = 9; // Marke/Generation ändern sich während der Ladung
  L.runs[0].resolve({ v: 1 });
  await p;
  const puts = st.of('put');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].slice(1), ['k', { v: 1 }, 5000, { mark: 3, gen: 2 }]);
});

test('C4 Ladung läuft, drop(k), Ladung löst auf ⇒ store.put nicht gerufen', async () => {
  const { createCache } = await load();
  const st = fakeStore(); const c = createCache({ store: st }); const L = manual();
  const p = c.load('k', L.fn);
  c.drop('k');
  L.runs[0].resolve({ v: 1 });
  await p;
  assert.equal(st.of('put').length, 0);
});

test('C5 drop(match) mit zwei Treffern ⇒ store.del([k1, k2])', async () => {
  const { createCache } = await load();
  const st = fakeStore(); const c = createCache({ store: st });
  for (const key of ['a|g|page:start', 'a|g|page:profil', 'a|g|group']) await c.load(key, () => 1);
  assert.equal(c.drop((p) => p.name.startsWith('page:')), 2);
  assert.deepEqual(st.of('del').map((x) => [...x[1]].sort()), [['a|g|page:profil', 'a|g|page:start']]);
});

test('C6 drop(match, { keepStored: true }) ⇒ store.del nicht gerufen, Arbeitsspeicher verworfen', async () => {
  const { createCache } = await load();
  const st = fakeStore(); const c = createCache({ store: st });
  for (const key of ['a|g|page:start', 'a|g|group']) await c.load(key, () => 1);
  assert.equal(c.drop((p) => p.name.startsWith('page:'), { keepStored: true }), 1);
  assert.equal(st.of('del').length, 0);
  assert.equal(c.peek('a|g|page:start'), undefined);
  assert.ok(c.peek('a|g|group'));
});

test('C7 clear() ⇒ store.clear() einmal', async () => {
  const { createCache } = await load();
  const st = fakeStore(); const c = createCache({ store: st });
  await c.load('k', () => 1);
  c.clear();
  assert.equal(st.of('clear').length, 1);
});

test('C8 load(null, L) ⇒ kein store-Aufruf; ohne store kein Wurf; setStore an pageCache', async () => {
  const { createCache, pageCache } = await load();
  const st = fakeStore(); const c = createCache({ store: st });
  assert.equal(await c.load(null, () => 5), 5);
  assert.equal(st.calls.length, 0);
  const bare = createCache();
  await bare.load('k', () => 1); bare.seed('s', 2, 1); bare.drop('k'); bare.drop('s', { keepStored: true }); bare.clear();
  assert.equal(typeof pageCache.setStore, 'function');
});
