// Spec P2 Revanche (Welle ttg-features, spec-p2-revanche.md Entscheide 2, 3, 6): Setup-Entwurf an einer Stelle
// (src/lib/setup-draft.js) — rematchDraft (R1–R9), rematchLoss (L1–L8), Entwurf lesen/schreiben/löschen (W1–W4).
// Modul je Fall per import() ⇒ ohne die Datei schlägt jeder Fall einzeln fehl (Gegenprobe G1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = () => import('../../src/lib/setup-draft.js');

const base = () => {
  const game = { id: 'g1', layout: 'rundum', startingLife: 30, firstSeat: 1 };
  const players = [
    { gameId: 'g1', memberId: 'a', deckId: 'da', seat: 2 },
    { gameId: 'g1', memberId: 'b', deckId: 'db', seat: 0 },
    { gameId: 'g1', memberId: 'c', deckId: 'db', seat: 1 },
  ];
  return { groupId: 'G', game, players };
};
const R1 = { sel: ['b', 'c', 'a'], deck: { b: 'db', c: 'db', a: 'da' }, layout: 'rundum', layoutSet: true, life: 30, lifeSet: true, start: null, roll: null, rematch: 'g1' };

/** Attrappe für sessionStorage (Node hat keins); throwGet/throwSet/raw für W3. */
function fakeStorage({ throwGet = false, throwSet = false, raw = undefined } = {}) {
  const m = new Map();
  return {
    map: m,
    getItem(k) { if (throwGet) throw new Error('gesperrt'); if (raw !== undefined) return raw; return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (throwSet) throw new Error('voll'); m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}
/** sessionStorage für die Dauer von fn ersetzen und danach zurücksetzen. */
async function withStorage(store, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true, writable: true });
  try { return await fn(store); } finally {
    if (before) Object.defineProperty(globalThis, 'sessionStorage', before);
    else delete globalThis.sessionStorage;
  }
}

// ---------------------------------------------------------------------------
// rematchDraft

test('P2 R1 Grundfall: Sitzordnung, Decks, Layout, Startleben, Marke; Startspieler/Wurf nie', async () => {
  const { rematchDraft } = await mod();
  assert.deepEqual(rematchDraft(base()), R1);
});

test('P2 R2 Layout null / undefined / unbekannt ⇒ layout null, layoutSet false', async () => {
  const { rematchDraft } = await mod();
  for (const layout of [null, undefined, 'quatsch']) {
    const d = base();
    d.game.layout = layout;
    assert.deepEqual(rematchDraft(d), { ...R1, layout: null, layoutSet: false }, String(layout));
  }
});

test('P2 R3 Startleben 4 / 100 / 40.5 / "30" / undefined ⇒ life null, lifeSet false', async () => {
  const { rematchDraft } = await mod();
  for (const life of [4, 100, 40.5, '30', undefined]) {
    const d = base();
    d.game.startingLife = life;
    assert.deepEqual(rematchDraft(d), { ...R1, life: null, lifeSet: false }, String(life));
  }
});

test('P2 R4 Zeile eines anderen Spiels zählt nicht', async () => {
  const { rematchDraft } = await mod();
  const d = base();
  d.players.push({ gameId: 'g2', memberId: 'x', deckId: 'dx', seat: 3 });
  const r = rematchDraft(d);
  assert.deepEqual(r.sel, ['b', 'c', 'a']);
  assert.ok(!('x' in r.deck));
});

test('P2 R5 Spieler ohne Deck ⇒ deck null, Spieler bleibt', async () => {
  const { rematchDraft } = await mod();
  const d = base();
  d.players[1].deckId = null;
  const r = rematchDraft(d);
  assert.deepEqual(r.sel, ['b', 'c', 'a']);
  assert.equal(r.deck.b, null);
});

test('P2 R6 Startspieler des Spiels (firstSeat / first_seat) wird nicht übernommen', async () => {
  const { rematchDraft } = await mod();
  const d = base();
  d.game.firstSeat = 2;
  d.game.first_seat = 2;
  const r = rematchDraft(d);
  assert.equal(r.start, null);
  assert.equal(r.roll, null);
});

test('P2 R7 Unsinn ⇒ null, kein Wurf', async () => {
  const { rematchDraft } = await mod();
  assert.equal(rematchDraft(null), null);
  assert.equal(rematchDraft(/** @type {any} */ ({})), null);
  assert.equal(rematchDraft(/** @type {any} */ ({ game: null })), null);
  assert.equal(rematchDraft(undefined), null);
});

test('P2 R8 sieben Spieler ⇒ alle sieben (Kürzen macht das Setup)', async () => {
  const { rematchDraft } = await mod();
  const d = base();
  d.players = Array.from({ length: 7 }, (_, i) => ({ gameId: 'g1', memberId: `m${i}`, deckId: `d${i}`, seat: i }));
  const r = rematchDraft(d);
  assert.equal(r.sel.length, 7);
  assert.deepEqual(r.sel, ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6']);
});

test('P2 R9 Dublette: Mitglied einmal, an der Position des kleineren Sitzes, dessen Deck', async () => {
  const { rematchDraft } = await mod();
  const d = base();
  d.players = [
    { gameId: 'g1', memberId: 'b', deckId: 'db', seat: 1 },
    { gameId: 'g1', memberId: 'a', deckId: 'da2', seat: 2 },
    { gameId: 'g1', memberId: 'a', deckId: 'da0', seat: 0 },
  ];
  const r = rematchDraft(d);
  assert.deepEqual(r.sel, ['a', 'b']);
  assert.equal(r.deck.a, 'da0');
});

// ---------------------------------------------------------------------------
// rematchLoss

test('P2 L1 Entwurf ohne Marke ⇒ null', async () => {
  const { rematchLoss } = await mod();
  assert.equal(rematchLoss({ sel: ['a'] }, { sel: [], deck: {} }), null);
  assert.equal(rematchLoss(null, { sel: [], deck: {} }), null);
  assert.equal(rematchLoss({ sel: ['a'], rematch: 5 }, { sel: [], deck: {} }), null);
});

test('P2 L2 nichts verloren ⇒ { players: 0, decks: 0 }', async () => {
  const { rematchLoss } = await mod();
  const draft = { sel: ['a', 'b'], deck: { a: 'da', b: 'db' }, rematch: 'g1' };
  assert.deepEqual(rematchLoss(draft, { sel: ['a', 'b'], deck: { a: 'da', b: 'db' } }), { players: 0, decks: 0 });
});

test('P2 L3 ein Spieler fehlt ⇒ players 1', async () => {
  const { rematchLoss } = await mod();
  const draft = { sel: ['a', 'b', 'x'], deck: { a: 'da', b: 'db', x: 'dx' }, rematch: 'g1' };
  assert.deepEqual(rematchLoss(draft, { sel: ['a', 'b'], deck: { a: 'da', b: 'db' } }), { players: 1, decks: 0 });
});

test('P2 L4 Deck ersetzt oder leer ⇒ decks 1', async () => {
  const { rematchLoss } = await mod();
  const draft = { sel: ['a'], deck: { a: 'd-arch' }, rematch: 'g1' };
  assert.equal(rematchLoss(draft, { sel: ['a'], deck: { a: 'd-own' } }).decks, 1);
  assert.equal(rematchLoss(draft, { sel: ['a'], deck: { a: null } }).decks, 1);
});

test('P2 L5 Deck war schon leer ⇒ decks 0', async () => {
  const { rematchLoss } = await mod();
  const draft = { sel: ['a'], deck: { a: null }, rematch: 'g1' };
  assert.equal(rematchLoss(draft, { sel: ['a'], deck: { a: 'd-own' } }).decks, 0);
});

test('P2 L6 Deck eines verlorenen Spielers zählt nicht', async () => {
  const { rematchLoss } = await mod();
  const draft = { sel: ['a', 'x'], deck: { a: 'da', x: 'dx' }, rematch: 'g1' };
  assert.deepEqual(rematchLoss(draft, { sel: ['a'], deck: { a: 'da' } }), { players: 1, decks: 0 });
});

test('P2 L7 sieben Spieler, Setup behält sechs ⇒ players 1', async () => {
  const { rematchLoss } = await mod();
  const ids = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  const deck = Object.fromEntries(ids.map((id) => [id, `d-${id}`]));
  const kept = ids.slice(0, 6);
  const r = rematchLoss({ sel: ids, deck, rematch: 'g1' }, { sel: kept, deck: Object.fromEntries(kept.map((id) => [id, deck[id]])) });
  assert.deepEqual(r, { players: 1, decks: 0 });
});

test('P2 L8 alle weg, eigenes Mitglied vorausgewählt ⇒ { players: 2, decks: 0 }', async () => {
  const { rematchLoss } = await mod();
  const draft = { sel: ['x', 'y'], deck: { x: 'dx', y: 'dy' }, rematch: 'g1' };
  assert.deepEqual(rematchLoss(draft, { sel: ['me'], deck: { me: 'd-me' } }), { players: 2, decks: 0 });
});

// ---------------------------------------------------------------------------
// Entwurf lesen / schreiben / löschen (verhaltensgleich aus setup.js umgezogen)

test('P2 W1 Rundreise: Schlüssel ttg.setup.<gid>, readDraft liefert den Revanche-Entwurf', async () => {
  const { writeDraft, readDraft, draftKey } = await mod();
  await withStorage(fakeStorage(), (st) => {
    writeDraft('G', R1);
    assert.deepEqual([...st.map.keys()], ['ttg.setup.G']);
    assert.equal(draftKey('G'), 'ttg.setup.G');
    assert.deepEqual(readDraft('G'), R1);
    assert.equal(readDraft('anders'), null);
  });
});

test('P2 W2 nur bekannte Felder; rematch nur, wenn gesetzt', async () => {
  const { writeDraft } = await mod();
  await withStorage(fakeStorage(), (st) => {
    const { rematch, ...ohne } = R1;
    writeDraft('G', { ...ohne, swap: 1, starting: true, error: 'x' });
    assert.deepEqual(Object.keys(JSON.parse(st.map.get('ttg.setup.G'))).sort(), ['deck', 'layout', 'layoutSet', 'life', 'lifeSet', 'roll', 'sel', 'start']);
    writeDraft('G', { ...ohne, rematch: undefined });
    assert.ok(!('rematch' in JSON.parse(st.map.get('ttg.setup.G'))), 'undefined ⇒ kein Feld');
    writeDraft('G', { ...ohne, rematch });
    assert.equal(JSON.parse(st.map.get('ttg.setup.G')).rematch, 'g1');
  });
});

test('P2 W3 Speicher kaputt: readDraft ⇒ null, writeDraft wirft nicht', async () => {
  const { writeDraft, readDraft, clearDraft } = await mod();
  await withStorage(fakeStorage({ throwGet: true, throwSet: true }), () => {
    assert.equal(readDraft('G'), null);
    assert.doesNotThrow(() => writeDraft('G', R1));
    assert.doesNotThrow(() => clearDraft('G'));
  });
  await withStorage(fakeStorage({ raw: '{kaputt' }), () => {
    assert.equal(readDraft('G'), null);
  });
  // ganz ohne sessionStorage (Node) ⇒ ebenso still
  assert.equal(readDraft('G'), null);
  assert.doesNotThrow(() => writeDraft('G', R1));
});

test('P2 W4 clearDraft entfernt den Schlüssel', async () => {
  const { writeDraft, clearDraft } = await mod();
  await withStorage(fakeStorage(), (st) => {
    writeDraft('G', R1);
    writeDraft('H', R1);
    clearDraft('G');
    assert.deepEqual([...st.map.keys()], ['ttg.setup.H']);
  });
});
