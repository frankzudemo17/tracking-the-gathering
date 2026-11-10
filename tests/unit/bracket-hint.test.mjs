// P7 (Welle ttg-live-feinschliff-decks): Bracket-Hinweis beim Spielstart — Sollwerte aus spec-p7-tisch.md „Spec-Tests“.
// bracketHint(decks) ⇒ null (kein Hinweis) oder Liste der Hinweise: zuerst je Deck { kind: 'check', deck, floor }
// (geprüftes Bracket über dem eingetragenen), dann höchstens ein { kind: 'spread', min, max } (≥ 2 Stufen auseinander).
// Dynamischer Import: am Start-main (Stub ohne Datei) wird jeder Fall rot statt die Datei nicht zu laden.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = async () => (await import('../../src/views/bracket-hint.js')).bracketHint;
const d = (bracket, floor) => ({ bracket, bracket_check: floor === undefined ? null : { floor } });

const CASES = [
  ['ein Deck', [d(4)], null],
  ['eng', [d(2), d(3)], null],
  ['weit', [d(2), d(4)], [{ kind: 'spread', min: 2, max: 4 }]],
  ['floor zählt', [d(2, 4), d(2)], [{ kind: 'check', deck: 0, floor: 4 }, { kind: 'spread', min: 2, max: 4 }]],
  ['floor 1', [d(2, 1), d(3)], null],
  ['ohne Check', [d(1), d(3, undefined)], [{ kind: 'spread', min: 1, max: 3 }]],
];

for (const [name, input, want] of CASES) {
  test(`bracketHint: ${name}`, async () => {
    const bracketHint = await load();
    assert.deepEqual(bracketHint(input), want);
  });
}

test('bracketHint: Ränder — leer, fehlende Decks, kaputte Werte, check ohne Spannweite', async () => {
  const bracketHint = await load();
  assert.equal(bracketHint([]), null);
  assert.equal(bracketHint(null), null);
  assert.equal(bracketHint(undefined), null);
  // fehlendes Deck (Spieler ohne Deck) zählt nicht mit
  assert.equal(bracketHint([d(2), null, undefined]), null);
  assert.deepEqual(bracketHint([null, d(2), d(5)]), [{ kind: 'spread', min: 2, max: 5 }]);
  // kaputter floor/bracket ⇒ ignoriert
  assert.equal(bracketHint([{ bracket: 2, bracket_check: { floor: 'x' } }, { bracket: 'drei' }]), null);
  assert.equal(bracketHint([{ bracket: 2, bracket_check: 'kaputt' }, d(3)]), null);
  // Prüfung über dem eingetragenen Bracket, aber Tisch eng ⇒ nur check
  assert.deepEqual(bracketHint([d(2, 3), d(3)]), [{ kind: 'check', deck: 0, floor: 3 }]);
  // geprüftes Bracket UNTER dem eingetragenen ⇒ kein check-Hinweis, floor zählt für die Spannweite
  assert.deepEqual(bracketHint([d(4, 2), d(4)]), [{ kind: 'spread', min: 2, max: 4 }]);
  // Index bezieht sich auf die Eingabeliste (auch mit Lücken)
  assert.deepEqual(bracketHint([d(3), null, d(2, 4)]), [{ kind: 'check', deck: 2, floor: 4 }]);
});
