// Reine Hilfen des Angriffs (src/views/attack-ui.js, Spec P10): Zieh-Schwelle, Ziel-Ermittlung,
// Zielauswahl „Alle Gegner“, Arten (Partner), Knopf- und Kopftexte, Zielfernrohr. Keine Spielregeln.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAG_PX, TAP_BLOCK_MS, ALL, QUICK, isDrag, opponents, hoverTarget, dropTargets, toggleTarget, allSelected, toggleAll,
  showAllChip, validTo, kinds, canLifelink, stepAmount, confirmLabel, headTo, barPct, scopeGeom,
} from '../../src/views/attack-ui.js';
import de from '../../src/i18n/de-attack.js';
import en from '../../src/i18n/en-attack.js';
import { createGame, act, previewAttack } from '../../src/game/engine.js';

const P = [
  { id: 'a', seat: 0, out: false }, { id: 'b', seat: 1, out: false },
  { id: 'c', seat: 2, out: true }, { id: 'd', seat: 3, out: false },
];

test('Schwellen wie Spec: 14 px, 400 ms, Schnellwahl 5/10/15/20', () => {
  assert.equal(DRAG_PX, 14);
  assert.equal(TAP_BLOCK_MS, 400);
  assert.deepEqual(QUICK, [5, 10, 15, 20]);
  assert.equal(isDrag(10, 0), false, '10 px bleibt ein Tippen');
  assert.equal(isDrag(13, 0), false);
  assert.equal(isDrag(14, 0), true);
  assert.equal(isDrag(10, 10), true, 'diagonal 14,1 px');
});

test('opponents: ohne Angreifer und Ausgeschiedene, Reihenfolge bleibt', () => {
  assert.deepEqual(opponents(P, 'a').map((p) => p.id), ['b', 'd']);
});

test('hoverTarget: eigenes Feld, Ausgeschiedene, Unbekannte, leer ⇒ null; Gegner ⇒ id; Mittelknopf ⇒ ALL', () => {
  assert.equal(hoverTarget('a', 'a', P), null);
  assert.equal(hoverTarget('c', 'a', P), null);
  assert.equal(hoverTarget('zz', 'a', P), null);
  assert.equal(hoverTarget(null, 'a', P), null);
  assert.equal(hoverTarget('b', 'a', P), 'b');
  assert.equal(hoverTarget(ALL, 'a', P), ALL);
  assert.equal(hoverTarget(ALL, 'a', [P[0], { ...P[1], out: true }]), null, 'ALL ohne lebenden Gegner ist kein Ziel');
});

test('dropTargets: ALL ⇒ alle lebenden Gegner; Gegner ⇒ [id]; sonst []', () => {
  assert.deepEqual(dropTargets(ALL, 'a', P), ['b', 'd']);
  assert.deepEqual(dropTargets('d', 'a', P), ['d']);
  assert.deepEqual(dropTargets('a', 'a', P), []);
  assert.deepEqual(dropTargets('c', 'a', P), []);
  assert.deepEqual(dropTargets(null, 'a', P), []);
});

test('Zielauswahl: frei kombinierbar, „Alle Gegner“ schaltet alle/keinen, nur bei > 1 Gegner', () => {
  assert.deepEqual(toggleTarget(['b'], 'd'), ['b', 'd']);
  assert.deepEqual(toggleTarget(['b', 'd'], 'b'), ['d']);
  assert.equal(allSelected(['d', 'b'], ['b', 'd']), true);
  assert.equal(allSelected(['b'], ['b', 'd']), false);
  assert.equal(allSelected(['b'], ['b']), false, 'ein Gegner ist nie „alle“');
  assert.deepEqual(toggleAll(['b'], ['b', 'd']), ['b', 'd']);
  assert.deepEqual(toggleAll(['b', 'd'], ['b', 'd']), []);
  assert.equal(showAllChip(['b']), false);
  assert.equal(showAllChip(['b', 'd']), true);
  assert.deepEqual(validTo(['d', 'c', 'b'], ['b', 'd']), ['b', 'd'], 'Ausgeschiedene fallen raus, Sitzreihenfolge');
});

test('kinds: ohne Partner Schaden · Commander · Gift; mit Partner beide Namen (cmd/cmd2)', () => {
  assert.deepEqual(kinds(de, null).map((k) => [k.kind, k.label]), [['damage', 'Schaden'], ['cmd', 'Commander'], ['poison', 'Gift']]);
  assert.deepEqual(kinds(de, ['Tymna', 'Thrasios']).map((k) => [k.kind, k.label]),
    [['damage', 'Schaden'], ['cmd', 'Tymna'], ['cmd2', 'Thrasios'], ['poison', 'Gift']]);
});

test('Lifelink nur ohne Gift; Menge min 1', () => {
  assert.equal(canLifelink('damage'), true);
  assert.equal(canLifelink('cmd2'), true);
  assert.equal(canLifelink('poison'), false);
  assert.equal(stepAmount(1, -1), 1);
  assert.equal(stepAmount(3, -1), 2);
  assert.equal(stepAmount(20, 1), 21);
});

test('confirmLabel: ohne Ziel „Ziel wählen“ und deaktiviert; Menge + Art [an N Gegner]', () => {
  assert.deepEqual(confirmLabel(de, { amount: 3, kind: 'damage', n: 0 }), { text: 'Ziel wählen', disabled: true });
  assert.deepEqual(confirmLabel(de, { amount: 3, kind: 'damage', n: 1 }), { text: '3 Schaden eintragen', disabled: false });
  assert.equal(confirmLabel(de, { amount: 7, kind: 'cmd2', n: 1 }).text, '7 Commander-Schaden eintragen');
  assert.equal(confirmLabel(de, { amount: 3, kind: 'damage', n: 3 }).text, '3 Schaden an 3 Gegner eintragen');
  assert.equal(confirmLabel(de, { amount: 2, kind: 'poison', n: 2 }).text, '2 Gift an 2 Gegner eintragen');
  assert.equal(confirmLabel(en, { amount: 3, kind: 'damage', n: 3 }).text, 'Record 3 damage on 3 opponents');
});

test('headTo: Alle Gegner · Name · N Gegner · Kein Ziel', () => {
  const nm = (id) => id.toUpperCase();
  assert.equal(headTo(de, ['b', 'd'], ['b', 'd'], nm), 'Alle Gegner');
  assert.equal(headTo(de, ['d'], ['b', 'd'], nm), 'D');
  assert.equal(headTo(de, ['b'], ['b'], nm), 'B', 'ein einziger Gegner heißt beim Namen');
  assert.equal(headTo(de, ['b', 'd'], ['b', 'd', 'e'], nm), '2 Gegner');
  assert.equal(headTo(de, [], ['b', 'd'], nm), 'Kein Ziel');
});

test('barPct und Zielfernrohr (R 30 frei, R 22 eingerastet)', () => {
  assert.equal(barPct(7, 21), (7 / 21) * 100);
  assert.equal(barPct(30, 21), 100);
  assert.equal(barPct(-1, 10), 0);
  assert.deepEqual([scopeGeom(false).r1, scopeGeom(false).r2], [30, 21]);
  assert.deepEqual([scopeGeom(true).r1, scopeGeom(true).r2], [22, 13]);
  assert.equal(scopeGeom(true).cross, 'M-34 0H-14M14 0H34M0 -34V-14M0 14V34');
});

test('de/en: gleiche Schlüssel (auch word.*)', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(en), keys(de));
});

test('Zusammenspiel mit der Engine: Ziele aus dropTargets ⇒ previewAttack = act (ein Angriff, alle Gegner)', () => {
  let s = createGame({ players: [{ id: 'a', seat: 0 }, { id: 'b', seat: 1 }, { id: 'c', seat: 2 }, { id: 'd', seat: 3 }], startingLife: 40 });
  s = act(s, { type: 'eliminate', target: 'c', by: null }).state;
  const to = dropTargets(ALL, 'a', s.players);
  assert.deepEqual(to, ['b', 'd']);
  const atk = { from: 'a', to, kind: 'damage', amount: 3, lifelink: true };
  const pv = previewAttack(s, atk);
  const r = act(s, { type: 'attack', ...atk });
  assert.equal(new Set(r.events.map((e) => e.payload.act)).size, 1, 'eine Aktion');
  for (const row of pv.targets) assert.equal(r.state.players.find((p) => p.id === row.id).life, row.life[1]);
  assert.equal(pv.lifelinkGain, 6);
});
