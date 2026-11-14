// Spec P4 Abzeichen: Fakten-Speicher src/lib/badge-facts.js — Kriterien 10, 11 (Fälle S1–S11) und die
// Write-Set-Ausnahme device-store.js (Nachtrag 3: eigener Objektspeicher `fakten`, Fälle DS1–DS4).
// Nach Nachtrag 2/3 liegt der Speicher im device-store statt unter localStorage `ttg.bf.*`; S1, S3, S4, S5, S6
// sind auf diesen Speicher umformuliert (gleiche Absicht, Tabelle alt → neu im Bericht). Modul je Fall per import().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BF = () => import('../../src/lib/badge-facts.js');
const DS = () => import('../../src/lib/device-store.js');
const HOUR = 3600000;

/** device-store mit Arbeitsspeicher-Hintergrund; zählt Aufrufe; optional werfende Methoden. */
async function setup(account = 'k1', { fail = [] } = {}) {
  const m = await DS();
  const backend = m.memoryBackend();
  const calls = { put: 0, del: 0, get: 0, all: 0, clear: 0 };
  const wrapped = Object.fromEntries(Object.entries(backend).filter(([, v]) => typeof v === 'function').map(([k, fn]) => [k, (...a) => {
    calls[k]++;
    if (fail.includes(k)) throw new Error(`${k} gesperrt`);
    return fn(...a);
  }]));
  const store = m.createDeviceStore({ backend: /** @type {any} */ (wrapped) });
  if (account) store.setAccount(account);
  const { clearBadgeFacts } = await BF();
  clearBadgeFacts(); // Modulzustand (Arbeitsspeicher-Kopie) je Fall frisch
  return { m, store, backend, calls };
}
const factKeys = async (backend) => [...(await backend.all('fakten'))].map((r) => r.key).sort();

const OK = (n = 0) => ({ v: 1, ok: true, min: { a: 40 - n }, gained: { a: 0 }, kos: [], startWinner: null });

/** n beendete Spiele x01…xnn (x01 ältestes), je zwei Spieler a/b. */
function groupWith(n, groupId = 'G1') {
  const games = []; const players = [];
  for (let i = 1; i <= n; i++) {
    const id = `x${String(i).padStart(2, '0')}`;
    const t = Date.UTC(2026, 9, 1, 18) + i * HOUR;
    games.push({ id, sessionId: null, status: 'finished', startedAt: new Date(t).toISOString(), endedAt: new Date(t + HOUR).toISOString(), round: 8, wincon: null, note: null, photoPath: null, startingLife: 40, layout: null });
    players.push({ gameId: id, memberId: 'a', deckId: null, seat: 0, place: 1, eliminatedRound: null, eliminatedBy: null, finalLife: 5 });
    players.push({ gameId: id, memberId: 'b', deckId: null, seat: 1, place: 2, eliminatedRound: null, eliminatedBy: 'a', finalLife: 0 });
  }
  return { groupId, members: [], decks: [], sessions: [], games, players, ratings: [], deckSalt: [], potg: [], turns: [] };
}
/** loadEvents-Attrappe: je Spiel ein Schadensereignis; zeichnet die Aufrufe auf; optional verzögert/werfend je Aufruf. */
function eventsSpy({ delay = null, failOn = [] } = {}) {
  const calls = [];
  const fn = async (ids) => {
    const n = calls.push([...ids]);
    if (delay) await delay;
    if (failOn.includes(n)) throw new Error('Netz weg');
    return ids.map((id) => ({ gameId: id, seq: 1, type: 'damage', source: 'b', target: 'a', amount: 3, payload: {} }));
  };
  return { fn, calls };
}
function gate() { let open; const p = new Promise((r) => { open = r; }); return { p, open: () => open() }; }

// ---------------------------------------------------------------------------
// S · Speicher

test('S1 Schlüssel: factsKey(k1, g1, x) = k1|g1|bf.1.x; Konto, Gruppe oder Spiel leer ⇒ null', async () => {
  const { factsKey } = await BF();
  assert.equal(factsKey('k1', 'g1', 'x'), 'k1|g1|bf.1.x');
  for (const [a, g, x] of [['', 'g1', 'x'], [null, 'g1', 'x'], ['k1', '', 'x'], ['k1', null, 'x'], ['k1', 'g1', ''], ['k1', 'g1', null]]) {
    assert.equal(factsKey(a, g, x), null, `${a}/${g}/${x}`);
  }
});

test('S2 Trennung: unter k1/G1 geschrieben ⇒ k1/G2 und k2/G1 leer, k1/G1 gefunden', async () => {
  const { store } = await setup('k1');
  const { writeFacts, readFacts, clearBadgeFacts } = await BF();
  writeFacts(store, 'k1', 'G1', 'x', OK(1));
  await store.flush();
  clearBadgeFacts(); // nur der Gerätespeicher zählt
  assert.equal((await readFacts(store, 'k1', 'G2', ['x'])).size, 0);
  assert.equal((await readFacts(store, 'k2', 'G1', ['x'])).size, 0);
  const got = await readFacts(store, 'k1', 'G1', ['x']);
  assert.deepEqual(got.get('x'), OK(1));
});

test('S3 Leeren (clearCaches = clearAll + clearBadgeFacts): alle fakten weg (alte Version, fremdes Konto), Arbeitsspeicher leer, localStorage unberührt', async () => {
  const { m, store, backend } = await setup('k1');
  const { writeFacts, readFacts, clearBadgeFacts } = await BF();
  const ls = new Map([['ttg.theme', 'nacht'], ['ttg.group', 'G1'], ['ttg-auth', 'x'], ['ttg.badgesOpen', '1']]);
  let lsCalls = 0;
  const prev = globalThis.localStorage;
  globalThis.localStorage = /** @type {any} */ ({ getItem: (k) => { lsCalls++; return ls.get(k) ?? null; }, setItem: () => { lsCalls++; }, removeItem: () => { lsCalls++; }, clear: () => { lsCalls++; }, key: () => { lsCalls++; return null; }, get length() { lsCalls++; return ls.size; } });
  try {
    writeFacts(store, 'k1', 'G1', 'x', OK());
    await backend.put('fakten', { key: 'k1|G1|bf.0.y', account: 'k1', group: 'G1', name: 'bf.0.y', fmt: m.STORE_FORMAT, value: OK() });
    await backend.put('fakten', { key: 'k9|G1|bf.1.x', account: 'k9', group: 'G1', name: 'bf.1.x', fmt: m.STORE_FORMAT, value: OK() });
    await store.flush();
    store.clearAll(); clearBadgeFacts();
    await store.flush();
    assert.deepEqual(await factKeys(backend), []);
    assert.equal((await readFacts(null, 'k1', 'G1', ['x'])).size, 0, 'Arbeitsspeicher-Kopie leer');
    assert.equal(lsCalls, 0, 'badge-facts fasst localStorage nie an');
    assert.deepEqual([...ls.keys()], ['ttg.theme', 'ttg.group', 'ttg-auth', 'ttg.badgesOpen']);
  } finally { globalThis.localStorage = prev; }
  // Verdrahtung: clearCaches ruft clearBadgeFacts (state.js ist in Node nicht ladbar ⇒ Quelltext)
  const src = readFileSync(new URL('../../src/state.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function clearCaches()'), src.indexOf('}', src.indexOf('export function clearCaches()')));
  assert.match(body, /deviceStore\.clearAll\(\)/); assert.match(body, /clearBadgeFacts\(\)/);
  assert.match(src, /import \{ clearBadgeFacts \} from '\.\/lib\/badge-facts\.js';/);
});

test('S4 Version: Eintrag bf.0.x wird nicht gelesen und beim Lesen entfernt', async () => {
  const { m, store, backend } = await setup('k1');
  const { readFacts } = await BF();
  await backend.put('fakten', { key: 'k1|G1|bf.0.x', account: 'k1', group: 'G1', name: 'bf.0.x', fmt: m.STORE_FORMAT, value: { ...OK(), v: 0 } });
  assert.equal((await readFacts(store, 'k1', 'G1', ['x'])).size, 0);
  await store.flush();
  assert.deepEqual(await factKeys(backend), []);
});

test('S5 kaputt/gesperrt: ungültiger Wert ⇒ fehlt + entfernt; Lesen wirft ⇒ leer; Schreiben wirft ⇒ kein Wurf, Arbeitsspeicher-Kopie lesbar', async () => {
  const a = await setup('k1');
  const { readFacts, writeFacts, ensureFacts } = await BF();
  await a.backend.put('fakten', { key: 'k1|G1|bf.1.x', account: 'k1', group: 'G1', name: 'bf.1.x', fmt: a.m.STORE_FORMAT, value: { v: 1, ok: 'ja' } });
  await a.backend.put('fakten', { key: 'k1|G1|bf.1.y', account: 'k1', group: 'G1', name: 'bf.1.y', fmt: a.m.STORE_FORMAT, value: '{kaputt' });
  assert.equal((await readFacts(a.store, 'k1', 'G1', ['x', 'y'])).size, 0);
  await a.store.flush();
  assert.deepEqual(await factKeys(a.backend), []);

  const b = await setup('k1', { fail: ['all', 'get'] });
  assert.equal((await readFacts(b.store, 'k1', 'G1', ['x'])).size, 0);

  const c = await setup('k1', { fail: ['put'] });
  assert.doesNotThrow(() => writeFacts(c.store, 'k1', 'G1', 'x', OK(2)));
  await c.store.flush();
  assert.deepEqual((await readFacts(c.store, 'k1', 'G1', ['x'])).get('x'), OK(2));
  const spy = eventsSpy();
  const r = await ensureFacts({ data: groupWith(3), account: 'k1', storage: c.store, loadEvents: spy.fn });
  await c.store.flush();
  assert.equal(r.loaded, 3); assert.equal(r.facts.size, 3);
  const again = await ensureFacts({ data: groupWith(3), account: 'k1', storage: c.store, loadEvents: spy.fn });
  assert.equal(spy.calls.length, 1, 'zweiter Lauf derselben Sitzung aus der Arbeitsspeicher-Kopie');
  assert.equal(again.facts.size, 3);
});

test('S6 Riegel: Leeren vor der Antwort ⇒ nichts geschrieben; Kontowechsel ⇒ nichts unter dem alten Konto', async () => {
  const { store, backend } = await setup('k1');
  const { ensureFacts, clearBadgeFacts, readFacts } = await BF();
  const ids = ['x01', 'x02', 'x03'];
  const g = gate();
  const run = ensureFacts({ data: groupWith(3), account: 'k1', storage: store, loadEvents: eventsSpy({ delay: g.p }).fn });
  await new Promise((r) => setTimeout(r, 5));
  store.clearAll(); clearBadgeFacts();
  g.open();
  await run; await store.flush();
  assert.deepEqual(await factKeys(backend), []);
  assert.equal((await readFacts(null, 'k1', 'G1', ids)).size, 0, 'auch die Arbeitsspeicher-Kopie bleibt leer');

  const s2 = await setup('k1');
  const g2 = gate();
  const first = ensureFacts({ data: groupWith(3), account: 'k1', storage: s2.store, loadEvents: eventsSpy({ delay: g2.p }).fn });
  await new Promise((r) => setTimeout(r, 5));
  s2.store.setAccount('k2');
  const second = ensureFacts({ data: groupWith(3), account: 'k2', storage: s2.store, loadEvents: eventsSpy().fn });
  await second;
  g2.open();
  await first; await s2.store.flush();
  const ks = await factKeys(s2.backend);
  assert.equal(ks.filter((k) => k.startsWith('k1|')).length, 0, 'nichts unter k1');
  assert.equal(ks.filter((k) => k.startsWith('k2|')).length, 3);
  assert.equal((await readFacts(null, 'k1', 'G1', ids)).size, 0, 'Kopie ohne k1');
});

test('S7 Laden: 25 Spiele, 5 gespeichert ⇒ 2 Pakete à 10, neueste zuerst; limit 15 ⇒ rest 5; onProgress je Paket; zweiter Lauf 0', async () => {
  const { store } = await setup('k1');
  const { ensureFacts, writeFacts, clearBadgeFacts } = await BF();
  const data = groupWith(25);
  for (const id of ['x25', 'x20', 'x13', 'x07', 'x01']) writeFacts(store, 'k1', 'G1', id, OK());
  await store.flush(); clearBadgeFacts();
  const spy = eventsSpy(); let progress = 0;
  const r = await ensureFacts({ data, account: 'k1', storage: store, loadEvents: spy.fn, onProgress: () => { progress++; } });
  assert.equal(spy.calls.length, 2);
  assert.deepEqual(spy.calls.map((c) => c.length), [10, 10]);
  assert.deepEqual(spy.calls[0], ['x24', 'x23', 'x22', 'x21', 'x19', 'x18', 'x17', 'x16', 'x15', 'x14'], 'neueste zuerst');
  assert.equal(progress, 2);
  assert.deepEqual([r.loaded, r.failed, r.rest, r.facts.size], [20, 0, 0, 25]);
  await store.flush(); clearBadgeFacts();
  const spy2 = eventsSpy();
  const r2 = await ensureFacts({ data, account: 'k1', storage: store, loadEvents: spy2.fn });
  assert.equal(spy2.calls.length, 0, 'zweiter Besuch lädt nichts (Gerätespeicher)');
  assert.equal(r2.facts.size, 25);

  const s = await setup('k1');
  for (const id of ['x25', 'x20', 'x13', 'x07', 'x01']) writeFacts(s.store, 'k1', 'G1', id, OK());
  await s.store.flush();
  const spy3 = eventsSpy();
  const r3 = await ensureFacts({ data, account: 'k1', storage: s.store, loadEvents: spy3.fn, limit: 15 });
  assert.deepEqual(spy3.calls.map((c) => c.length), [10, 5]);
  assert.deepEqual([r3.loaded, r3.rest], [15, 5]);
  const { FACTS_BATCH, FACTS_LIMIT, PERSIST } = await BF();
  assert.deepEqual([FACTS_BATCH, FACTS_LIMIT, PERSIST], [10, 200, true]);
});

test('S8 Fehler: zweites Paket wirft ⇒ failed 10, erstes Paket gespeichert, zweites nicht', async () => {
  const { store, backend } = await setup('k1');
  const { ensureFacts } = await BF();
  const spy = eventsSpy({ failOn: [2] });
  const r = await ensureFacts({ data: groupWith(20), account: 'k1', storage: store, loadEvents: spy.fn });
  await store.flush();
  assert.deepEqual([r.loaded, r.failed], [10, 10]);
  const ks = await factKeys(backend);
  assert.equal(ks.length, 10);
  assert.deepEqual(ks, spy.calls[0].map((id) => `k1|G1|bf.1.${id}`).sort());
});

test('S9 gleichzeitig: zwei ensureFacts für dieselben Spiele ⇒ jedes Spiel genau einmal in loadEvents', async () => {
  const { store } = await setup('k1');
  const { ensureFacts } = await BF();
  const spy = eventsSpy();
  const data = groupWith(15);
  const [a, b] = await Promise.all([
    ensureFacts({ data, account: 'k1', storage: store, loadEvents: spy.fn }),
    ensureFacts({ data, account: 'k1', storage: store, loadEvents: spy.fn }),
  ]);
  const all = spy.calls.flat();
  assert.equal(all.length, 15); assert.equal(new Set(all).size, 15);
  assert.equal(a.facts.size, 15); assert.equal(b.facts.size, 15);
});

test('S10 Aufräumen: pruneFacts(k1, G1, [g1, g3]) ⇒ g2 weg, andere Gruppe und anderes Konto unberührt', async () => {
  const { m, store, backend } = await setup('k1');
  const { writeFacts, pruneFacts } = await BF();
  for (const id of ['g1', 'g2', 'g3']) writeFacts(store, 'k1', 'G1', id, OK());
  writeFacts(store, 'k1', 'G2', 'g2', OK());
  await store.flush();
  await backend.put('fakten', { key: 'k2|G1|bf.1.g2', account: 'k2', group: 'G1', name: 'bf.1.g2', fmt: m.STORE_FORMAT, value: OK() });
  await pruneFacts(store, 'k1', 'G1', ['g1', 'g3']);
  await store.flush();
  assert.deepEqual(await factKeys(backend), ['k1|G1|bf.1.g1', 'k1|G1|bf.1.g3', 'k1|G2|bf.1.g2', 'k2|G1|bf.1.g2']);
});

test('S11 ohne Persistenz: persist false ⇒ 0 Schreibzugriffe, Fakten trotzdem zurückgegeben', async () => {
  const { store, calls } = await setup('k1');
  const { ensureFacts } = await BF();
  const r = await ensureFacts({ data: groupWith(4), account: 'k1', storage: store, loadEvents: eventsSpy().fn, persist: false });
  await store.flush();
  assert.equal(calls.put, 0); assert.equal(calls.del, 0);
  assert.equal(r.facts.size, 4); assert.ok([...r.facts.values()].every((f) => f.ok));
});

test('S12 ohne loadEvents (Vorschau) ⇒ nichts geladen, rest = fehlende; isStale ⇒ keine weiteren Pakete, keine Rückrufe', async () => {
  const { store } = await setup('k1');
  const { ensureFacts } = await BF();
  const r = await ensureFacts({ data: groupWith(12), account: 'k1', storage: store });
  assert.deepEqual([r.loaded, r.failed, r.rest, r.facts.size], [0, 0, 12, 0]);
  const spy = eventsSpy(); let stale = false; let progress = 0;
  const r2 = await ensureFacts({ data: groupWith(25), account: 'k1', storage: store, loadEvents: async (ids) => { const x = await spy.fn(ids); stale = true; return x; }, isStale: () => stale, onProgress: () => { progress++; } });
  assert.equal(spy.calls.length, 1); assert.equal(progress, 0);
  assert.equal(r2.loaded, 10, 'gerechnete Fakten bleiben');
  await store.flush();
  const r3 = await ensureFacts({ data: groupWith(25), account: 'k1', storage: store, loadEvents: spy.fn });
  assert.equal(r3.loaded, 15);
});

// ---------------------------------------------------------------------------
// DS · device-store-Erweiterung (Objektspeicher fakten)

test('DS1 putFacts: Riegel Generation (clearAll davor) und Konto', async () => {
  const { store, backend } = await setup('k1');
  const g = store.generation();
  store.clearAll();
  store.putFacts('k1|G1|bf.1.x', OK(), { gen: g });
  store.putFacts('k2|G1|bf.1.y', OK(), { gen: store.generation() });
  store.putFacts('k1||bf.1.z', OK(), { gen: store.generation() });
  await store.flush();
  assert.deepEqual(await factKeys(backend), []);
  store.putFacts('k1|G1|bf.1.x', OK(), { gen: store.generation() });
  await store.flush();
  assert.deepEqual(await factKeys(backend), ['k1|G1|bf.1.x']);
});

test('DS2 hydrate und noteWrite lassen fakten unberührt; clearAll leert fakten', async () => {
  const { store, backend } = await setup('k1');
  store.putFacts('k1|G1|bf.1.x', OK(), { gen: store.generation() });
  await store.flush();
  const h = await store.hydrate('k1', { group: 'G1' });
  assert.deepEqual(h.entries, []);
  store.noteWrite();
  await store.flush();
  assert.deepEqual(await factKeys(backend), ['k1|G1|bf.1.x']);
  store.clearAll();
  await store.flush();
  assert.deepEqual(await factKeys(backend), []);
});

test('DS3 factsOf: nur Konto + Gruppe; eigene Datensätze mit falschem Format gekehrt, fremde Konten liegen', async () => {
  const { m, store, backend } = await setup('k1');
  await backend.put('fakten', { key: 'k1|G1|bf.1.a', account: 'k1', group: 'G1', name: 'bf.1.a', fmt: m.STORE_FORMAT, value: 1 });
  await backend.put('fakten', { key: 'k1|G2|bf.1.b', account: 'k1', group: 'G2', name: 'bf.1.b', fmt: m.STORE_FORMAT, value: 2 });
  await backend.put('fakten', { key: 'k1|G1|bf.1.c', account: 'k1', group: 'G1', name: 'bf.1.c', fmt: m.STORE_FORMAT + 1, value: 3 });
  await backend.put('fakten', { key: 'k1|G1|bf.1.d', account: 'k9', group: 'G1', name: 'bf.1.d', fmt: m.STORE_FORMAT, value: 4 });
  await backend.put('fakten', { key: 'k9|G1|bf.1.e', account: 'k9', group: 'G1', name: 'bf.1.e', fmt: m.STORE_FORMAT, value: 5 });
  const got = await store.factsOf('k1', 'G1');
  assert.deepEqual(got.map((r) => r.value), [1]);
  assert.deepEqual(await store.factsOf('', 'G1'), []);
  await store.flush();
  assert.deepEqual(await factKeys(backend), ['k1|G1|bf.1.a', 'k1|G2|bf.1.b', 'k9|G1|bf.1.e']);
});

test('DS4 idbBackend legt fakten an (Version 2) — Quelltext', async () => {
  const src = readFileSync(new URL('../../src/lib/device-store.js', import.meta.url), 'utf8');
  assert.match(src, /idb\.open\(name, 2\)/);
  assert.match(src, /for \(const s of \['daten', 'bilder', FACTS\]\)/);
  const { memoryBackend } = await DS();
  assert.ok(memoryBackend().maps.fakten instanceof Map);
});
