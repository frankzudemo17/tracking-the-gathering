// Spec P2: Bracket-Rechner (src/decks/bracket.js). Jeder Fall lädt das Modul selbst per import()
// (Gegenprobe: am Stand ohne Modul ist jeder Fall rot, nicht die ganze Datei).
// Eingaben in der gekürzten Form der Edge Function (supabase/functions/spellbook/core.js → trim).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/decks/bracket.js');

const card = (name, flags = {}) => ({
  name, gameChanger: false, massLandDenial: false, extraTurn: false, banned: false, ...flags,
});
const combo = (id, cards, flags = {}) => ({
  id, cards, produces: ['Infinite mana'], definitelyTwoCard: false, arguablyTwoCard: false,
  manaValueNeeded: 3, extraTurn: false, massLandDenial: false, lock: false, speed: 3, tag: 'S', ...flags,
});
const sb = (cards = [], combos = [], extra = {}) => ({ tag: 'C', cards, combos, almost: [], ...extra });
const codes = (r) => r.reasons.map((x) => x.code).sort();
const reason = (r, code) => r.reasons.find((x) => x.code === code);
const hint = (r, code) => r.hints.find((x) => x.code === code);

// ---- Sollwert-Tabelle der Spec ---------------------------------------------------------------

test('leer: 0 GC, 0 Kombos ⇒ floor 1, keine Gründe', async () => {
  const B = await load();
  const r = B.bracketFloor(sb());
  assert.equal(r.floor, 1);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.hints, []);
  assert.deepEqual(r.banned, []);
  assert.equal(r.tag, 'C');
});

test('GC 3 ⇒ floor 3, Grund gc mit 3 Namen (Bracket 3: „Up to three“)', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([
    card('Rhystic Study', { gameChanger: true }),
    card('Cyclonic Rift', { gameChanger: true }),
    card('Smothering Tithe', { gameChanger: true }),
    card('Sol Ring'),
  ]));
  assert.equal(r.floor, 3);
  assert.deepEqual(codes(r), ['gc']);
  assert.equal(reason(r, 'gc').floor, 3);
  assert.deepEqual(reason(r, 'gc').cards, ['Cyclonic Rift', 'Rhystic Study', 'Smothering Tithe']);
});

test('GC 1 ⇒ floor 3 (untere Kante)', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([card('Rhystic Study', { gameChanger: true })]));
  assert.equal(r.floor, 3);
  assert.deepEqual(reason(r, 'gc'), { code: 'gc', floor: 3, cards: ['Rhystic Study'] });
});

test('GC 4 ⇒ floor 4, Grund gc', async () => {
  const B = await load();
  const r = B.bracketFloor(sb(['A', 'B', 'C', 'D'].map((n) => card(n, { gameChanger: true }))));
  assert.equal(r.floor, 4);
  assert.deepEqual(codes(r), ['gc']);
  assert.equal(reason(r, 'gc').floor, 4);
  assert.equal(reason(r, 'gc').cards.length, 4);
});

test('MLD: 1 Karte massLandDenial ⇒ floor 4, Grund mld', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([card('Armageddon', { massLandDenial: true })]));
  assert.equal(r.floor, 4);
  assert.deepEqual(reason(r, 'mld'), { code: 'mld', floor: 4, cards: ['Armageddon'] });
});

test('MLD über Kombo ⇒ floor 4, Karten der Kombo im Grund', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([], [combo('1-2', ['Stasis', 'Chronosavant'], { massLandDenial: true, lock: true })]));
  assert.equal(r.floor, 4);
  assert.deepEqual(reason(r, 'mld').cards, ['Chronosavant', 'Stasis']);
});

test('Extrazug 2 Karten ⇒ floor 1, Hinweis extra_turns', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([card('Time Warp', { extraTurn: true }), card('Temporal Manipulation', { extraTurn: true })]));
  assert.equal(r.floor, 1);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(hint(r, 'extra_turns').cards, ['Temporal Manipulation', 'Time Warp']);
});

test('Extrazug 3 Karten ⇒ floor 4, Grund extra_turn_chain', async () => {
  const B = await load();
  const r = B.bracketFloor(sb(['Time Warp', 'Temporal Manipulation', 'Capture of Jingzhou'].map((n) => card(n, { extraTurn: true }))));
  assert.equal(r.floor, 4);
  assert.deepEqual(codes(r), ['extra_turn_chain']);
  assert.equal(reason(r, 'extra_turn_chain').cards.length, 3);
  assert.equal(hint(r, 'extra_turns'), undefined);
});

test('Extrazug-Kombo ⇒ floor 4, Grund extra_turn_chain', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([card('Nexus of Fate', { extraTurn: true })],
    [combo('9-9', ['Nexus of Fate', 'Mystic Sanctuary'], { extraTurn: true })]));
  assert.equal(r.floor, 4);
  assert.deepEqual(reason(r, 'extra_turn_chain').cards, ['Mystic Sanctuary', 'Nexus of Fate']);
});

test('Kombo früh: definitelyTwoCard, manaValueNeeded 3 ⇒ floor 4, combo_early', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([], [combo('742-1295', ["Thassa's Oracle", 'Demonic Consultation'], { definitelyTwoCard: true, arguablyTwoCard: true, manaValueNeeded: 3 })]));
  assert.equal(r.floor, 4);
  assert.deepEqual(codes(r), ['combo_early']);
  assert.deepEqual(reason(r, 'combo_early').cards, ['Demonic Consultation', "Thassa's Oracle"]);
});

test('Kombo-Grenze: manaValueNeeded 4 ⇒ combo_early (4), 5 ⇒ combo (3)', async () => {
  const B = await load();
  const at = (mv) => B.bracketFloor(sb([], [combo('x', ['A', 'B'], { definitelyTwoCard: true, manaValueNeeded: mv })]));
  assert.equal(at(4).floor, 4);
  assert.deepEqual(codes(at(4)), ['combo_early']);
  assert.equal(at(5).floor, 3);
  assert.deepEqual(codes(at(5)), ['combo']);
});

test('Kombo spät: definitelyTwoCard, manaValueNeeded 6 ⇒ floor 3, combo', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([], [combo('a-b', ['Exquisite Blood', 'Sanguine Bond'], { definitelyTwoCard: true, manaValueNeeded: 6 })]));
  assert.equal(r.floor, 3);
  assert.deepEqual(reason(r, 'combo'), { code: 'combo', floor: 3, cards: ['Exquisite Blood', 'Sanguine Bond'] });
});

test('Kombo ohne manaValueNeeded (null) ⇒ nicht als früh gewertet: combo (3)', async () => {
  const B = await load();
  for (const mv of [null, undefined, 'x']) {
    const r = B.bracketFloor(sb([], [combo('n', ['A', 'B'], { definitelyTwoCard: true, manaValueNeeded: mv })]));
    assert.equal(r.floor, 3, `mv ${mv}`);
    assert.deepEqual(codes(r), ['combo']);
  }
});

test('nur arguably ⇒ floor 1, Hinweis combo_arguable', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([], [combo('c-d', ['Basalt Monolith', 'Rings of Brighthearth'], { arguablyTwoCard: true, definitelyTwoCard: false, manaValueNeeded: 5 })]));
  assert.equal(r.floor, 1);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(hint(r, 'combo_arguable').cards, ['Basalt Monolith', 'Rings of Brighthearth']);
});

test('Kombo mit drei Karten (weder definitely noch arguably) ⇒ kein Grund', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([], [combo('3k', ['A', 'B', 'C'])]));
  assert.equal(r.floor, 1);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.hints, []);
});

test('Kombination: GC 2 + Kombo spät + MLD ⇒ floor 4 · gc(3), combo(3), mld(4)', async () => {
  const B = await load();
  const r = B.bracketFloor(sb(
    [card('Rhystic Study', { gameChanger: true }), card('Cyclonic Rift', { gameChanger: true }), card('Armageddon', { massLandDenial: true })],
    [combo('a-b', ['Exquisite Blood', 'Sanguine Bond'], { definitelyTwoCard: true, manaValueNeeded: 6 })],
  ));
  assert.equal(r.floor, 4);
  assert.deepEqual(codes(r), ['combo', 'gc', 'mld']);
  assert.equal(reason(r, 'gc').floor, 3);
  assert.equal(reason(r, 'combo').floor, 3);
  assert.equal(reason(r, 'mld').floor, 4);
});

test('banned ⇒ eigene Liste, ändert floor nicht', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([card('Prophet of Kruphix', { banned: true })]));
  assert.equal(r.floor, 1);
  assert.deepEqual(r.banned, ['Prophet of Kruphix']);
  assert.deepEqual(r.reasons, []);
});

test('Tutor-/Fast-Mana-Hinweise aus dem Aufrufer: Anzahl oder Namen, nie Grund', async () => {
  const B = await load();
  const r = B.bracketFloor(sb(), { tutorsHint: 5, fastManaHint: ['Mana Crypt', 'Chrome Mox'] });
  assert.equal(r.floor, 1);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(hint(r, 'tutors'), { code: 'tutors', cards: [], count: 5 });
  assert.deepEqual(hint(r, 'fast_mana'), { code: 'fast_mana', cards: ['Chrome Mox', 'Mana Crypt'], count: 2 });
  const none = B.bracketFloor(sb(), { tutorsHint: 0 });
  assert.deepEqual(none.hints, []);
});

test('unbekannte Karten ⇒ Hinweis unknown_cards mit Anzahl', async () => {
  const B = await load();
  const r = B.bracketFloor(sb([], [], { unknown: { count: 2, cards: ['Sejiri Shelter', "Michiko's Reign of Truth"] } }));
  assert.equal(r.floor, 1);
  assert.deepEqual(hint(r, 'unknown_cards'), { code: 'unknown_cards', cards: ["Michiko's Reign of Truth", 'Sejiri Shelter'], count: 2 });
});

test('kaputte Eingabe (null, fehlende Listen) ⇒ floor 1 ohne Absturz', async () => {
  const B = await load();
  for (const x of [null, undefined, {}, { cards: null, combos: null }]) {
    const r = B.bracketFloor(x);
    assert.equal(r.floor, 1);
    assert.deepEqual(r.reasons, []);
  }
});

test('Bracket 5 wird nie errechnet', async () => {
  const B = await load();
  const r = B.bracketFloor(sb(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => card(n, { gameChanger: true, massLandDenial: true, extraTurn: true })),
    [combo('x', ['A', 'B'], { definitelyTwoCard: true, manaValueNeeded: 0, extraTurn: true })],
  ));
  assert.equal(r.floor, 4);
});

// ---- compareBracket ---------------------------------------------------------------------------

const CMP = [
  // [Besitzer, floor, Soll, Quelle]
  [2, 3, 'below', 'Entscheid'],
  [2, 1, 'ok', 'floor 1 = „1–2“'],
  [4, 1, 'above', 'Entscheid (nur Hinweis)'],
  [3, 1, 'above', '3 ≥ 1 + 2 und ≥ 3'],
  [4, 3, 'ok', 'Abstand 1'],
  [5, 3, 'above', 'Abstand 2'],
  [1, 1, 'ok', 'Entscheid'],
  [3, 4, 'below', 'Entscheid'],
];
for (const [owner, floor, want, why] of CMP) {
  test(`compareBracket: Besitzer ${owner}, floor ${floor} ⇒ ${want} (${why})`, async () => {
    const B = await load();
    assert.equal(B.compareBracket(owner, { floor }), want);
    assert.equal(B.compareBracket(owner, floor), want); // auch mit nackter Zahl
  });
}

test('compareBracket: kein Besitzer-Bracket ⇒ ok (nichts zu vergleichen)', async () => {
  const B = await load();
  assert.equal(B.compareBracket(null, { floor: 4 }), 'ok');
  assert.equal(B.compareBracket(undefined, 3), 'ok');
});
