// P7 (Welle ttg-live-feinschliff-decks): Geräte-Einstellungen src/lib/prefs.js — Standards, Robustheit, Hörer.
// Jeder Fall importiert das Modul frisch (Query-Anhang), mit eigener localStorage-Attrappe.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'ttg.prefs.v1';
let n = 0;

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}
async function fresh(storage) {
  if (storage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = storage;
  return import(`../../src/lib/prefs.js?t=${++n}`);
}

test('leerer Speicher ⇒ DEFAULTS (Spec-Tabelle)', async () => {
  const P = await fresh(fakeStorage());
  assert.deepEqual(P.DEFAULTS, {
    wakeLock: true, vibration: true, koScreens: 'all', koVariants: ['A', 'B', 'C'], reduceMotion: 'system',
    startLife: 40, layout: 'seiten', defaultPins: ['poison', 'tax'], turnTime: true, startIntro: true,
  });
  assert.deepEqual(P.getPrefs(), P.DEFAULTS);
  // getPrefs liefert eine Kopie: Änderungen daran wirken nicht zurück
  const a = P.getPrefs(); a.koVariants.push('X'); a.startLife = 1;
  assert.deepEqual(P.getPrefs(), P.DEFAULTS);
});

test('kaputtes JSON ⇒ DEFAULTS, kein Wurf', async () => {
  for (const raw of ['{kaputt', 'null', '42', '"text"', '[]', '{"startLife":']) {
    const P = await fresh(fakeStorage({ [KEY]: raw }));
    assert.doesNotThrow(() => P.getPrefs(), raw);
    assert.deepEqual(P.getPrefs(), P.DEFAULTS, raw);
  }
  // werfender Speicher (gesperrte Website-Daten)
  const P = await fresh({ getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } });
  assert.deepEqual(P.getPrefs(), P.DEFAULTS);
  assert.doesNotThrow(() => P.setPref('startLife', 30));
  assert.equal(P.getPrefs().startLife, 30); // fällt auf Speicher im Lauf zurück
});

test('ungültige Einzelwerte ⇒ Standard je Feld (startLife 33 ⇒ 40), gültige bleiben', async () => {
  const stored = {
    startLife: 33, wakeLock: 'ja', vibration: false, koScreens: 'bunt', koVariants: ['B', 'Z', 'B', 7],
    reduceMotion: 'on', layout: 'kreis', defaultPins: ['energy', 'quatsch', 'energy', 'tax'], turnTime: 0,
  };
  const P = await fresh(fakeStorage({ [KEY]: JSON.stringify({ v: 1, ...stored }) }));
  assert.deepEqual(P.getPrefs(), {
    wakeLock: true, vibration: false, koScreens: 'all', koVariants: ['B'], reduceMotion: 'on',
    startLife: 40, layout: 'seiten', defaultPins: ['energy', 'tax'], turnTime: true, startIntro: true,
  });
  // unbekannte K.O.-Varianten (umbenannt/entfernt) werden ignoriert; bleibt nichts übrig ⇒ alle
  const Q = await fresh(fakeStorage({ [KEY]: JSON.stringify({ koScreens: 'some', koVariants: ['Z'] }) }));
  assert.deepEqual(Q.getPrefs().koVariants, ['A', 'B', 'C']);
  // leere Pin-Liste ist ein gültiger Wunsch (nichts angepinnt)
  const R = await fresh(fakeStorage({ [KEY]: JSON.stringify({ defaultPins: [] }) }));
  assert.deepEqual(R.getPrefs().defaultPins, []);
  // jede Startleben-Stufe der Liste ist gültig
  for (const v of [20, 30, 40, 50, 60]) {
    const S = await fresh(fakeStorage({ [KEY]: JSON.stringify({ startLife: v }) }));
    assert.equal(S.getPrefs().startLife, v);
  }
});

test('setPref persistiert (versioniert) und ruft onPrefs-Hörer; off() meldet ab', async () => {
  const st = fakeStorage();
  const P = await fresh(st);
  const seen = [];
  const off = P.onPrefs((p) => seen.push(p.startLife));
  assert.equal(P.setPref('startLife', 30), true);
  assert.equal(JSON.parse(st.getItem(KEY)).startLife, 30);
  assert.equal(JSON.parse(st.getItem(KEY)).v, 1);
  assert.deepEqual(seen, [30]);
  // ungültiger Wert ⇒ nichts geschrieben, kein Hörer-Aufruf
  assert.equal(P.setPref('startLife', 33), false);
  assert.equal(P.setPref('gibtsnicht', 1), false);
  assert.deepEqual(seen, [30]);
  assert.equal(P.getPrefs().startLife, 30);
  off();
  P.setPref('startLife', 20);
  assert.deepEqual(seen, [30]);
  // ein frisch geladenes Modul (anderer Tab/Neustart) liest den gespeicherten Wert
  const P2 = await fresh(st);
  assert.equal(P2.getPrefs().startLife, 20);
});

test('ohne localStorage ⇒ Werte im Lauf', async () => {
  const P = await fresh(undefined);
  assert.deepEqual(P.getPrefs(), P.DEFAULTS);
  assert.equal(P.setPref('koScreens', 'off'), true);
  assert.equal(P.setPref('defaultPins', ['rad']), true);
  assert.equal(P.getPrefs().koScreens, 'off');
  assert.deepEqual(P.getPrefs().defaultPins, ['rad']);
});

test('zweiter Tab: storage-Ereignis ruft onPrefs-Hörer mit dem neuen Stand', async () => {
  const st = fakeStorage();
  const handlers = [];
  globalThis.addEventListener = (type, fn) => { if (type === 'storage') handlers.push(fn); };
  globalThis.removeEventListener = (type, fn) => { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); };
  try {
    const P = await fresh(st);
    const seen = [];
    const off = P.onPrefs((p) => seen.push(p.koScreens));
    st.setItem(KEY, JSON.stringify({ v: 1, koScreens: 'some' })); // Tab 1 schreibt
    for (const h of handlers) h({ key: KEY });
    for (const h of handlers) h({ key: 'anderer.schluessel' });
    assert.deepEqual(seen, ['some']);
    off();
    assert.equal(handlers.length, 0);
  } finally {
    delete globalThis.addEventListener;
    delete globalThis.removeEventListener;
  }
});

test('buzz(): Schalter aus ⇒ kein vibrate-Aufruf, an ⇒ Aufruf; fehlende API wirft nie', async () => {
  const calls = [];
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (p) => { calls.push(p); return true; } }, configurable: true, writable: true });
  try {
    const P = await fresh(fakeStorage());
    assert.equal(P.canVibrate(), true);
    P.buzz(12);
    P.setPref('vibration', false);
    P.buzz(12);
    P.buzz([20, 40]);
    assert.deepEqual(calls, [12]);
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    P.setPref('vibration', true);
    assert.equal(P.canVibrate(), false);
    assert.doesNotThrow(() => P.buzz(12));
  } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
});

test('reducedMotion(): on/off gehen der System-Einstellung vor, system fragt matchMedia', async () => {
  let sys = true;
  globalThis.matchMedia = () => ({ matches: sys });
  try {
    const P = await fresh(fakeStorage());
    assert.equal(P.reducedMotion(), true);
    sys = false;
    assert.equal(P.reducedMotion(), false);
    P.setPref('reduceMotion', 'on');
    assert.equal(P.reducedMotion(), true);
    sys = true;
    P.setPref('reduceMotion', 'off');
    assert.equal(P.reducedMotion(), false);
  } finally {
    delete globalThis.matchMedia;
  }
});

test('koVariantFor(): all ⇒ gezogene Variante, some ⇒ nur erlaubte, deterministisch', async () => {
  const P = await fresh(fakeStorage());
  assert.equal(P.koVariantFor({ variant: 'B', quote: 3 }), 'B');
  P.setPref('koScreens', 'some');
  P.setPref('koVariants', ['A']);
  for (const v of ['A', 'B', 'C']) for (let q = 0; q < 8; q++) assert.equal(P.koVariantFor({ variant: v, quote: q }), 'A');
  P.setPref('koVariants', ['A', 'C']);
  assert.equal(P.koVariantFor({ variant: 'C', quote: 5 }), 'C');
  assert.ok(['A', 'C'].includes(P.koVariantFor({ variant: 'B', quote: 5 })));
  assert.equal(P.koVariantFor({ variant: 'B', quote: 5 }), P.koVariantFor({ variant: 'B', quote: 5 }));
});

// Spec P3 (Welle ttg-features, Entscheid 11): Schalter „Intro beim Spielstart“ — Tabelle „Spec-Tests · prefs“
test('P3 startIntro: Standard an, ungültig ⇒ an, setPref false gespeichert, Unsinn abgelehnt', async () => {
  const P = await fresh(fakeStorage());
  assert.equal(P.DEFAULTS.startIntro, true);
  const Q = await fresh(fakeStorage({ [KEY]: JSON.stringify({ v: 1, startIntro: 'ja' }) }));
  assert.equal(Q.getPrefs().startIntro, true);
  const st = fakeStorage();
  const R = await fresh(st);
  assert.equal(R.setPref('startIntro', false), true);
  assert.equal(R.getPrefs().startIntro, false);
  assert.ok(st.getItem(KEY).includes('"startIntro":false'), st.getItem(KEY));
  const st2 = fakeStorage();
  const S = await fresh(st2);
  assert.equal(S.setPref('startIntro', 'x'), false);
  assert.equal(st2.getItem(KEY), null, 'nichts geschrieben');
});
