// Reine Anzeige-Hilfen des Lifecounters (src/views/life-ui.js, Spec P8): Zeit, Vorzeichen,
// Zähler-Reihenfolge und Pins, Wurf- und Verlaufstexte, Anzeige-Schwellen. Keine Spielregeln.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mmss, signed, COUNTER_KEYS, DEFAULT_PINS, counterRows, togglePin, rollText, logText,
  lowLife, critical, CRIT, shortCmd, cmdLine, byPlace, flickerValue, secondsSince,
} from '../../src/views/life-ui.js';
import de from '../../src/i18n/de-life.js';
import { createGame, act, history, COUNTER_MAX, POISON_MAX } from '../../src/game/engine.js';

test('mmss: mm:ss, ab einer Stunde h:mm:ss, Negativ/Unsinn ⇒ 00:00', () => {
  assert.equal(mmss(0), '00:00');
  assert.equal(mmss(65), '01:05');
  assert.equal(mmss(3599), '59:59');
  assert.equal(mmss(3600 + 62), '1:01:02');
  assert.equal(mmss(-5), '00:00');
  assert.equal(mmss('x'), '00:00');
});

test('signed: echtes Minus, Plus, Null', () => {
  assert.equal(signed(3), '+3');
  assert.equal(signed(-3), '−3');
  assert.equal(signed(0), '0');
});

test('counterRows: Standard-Pins oben, Rest unter „Weitere“, tax2 nur mit Partner', () => {
  const p = { poison: 0, tax: 0, tax2: 0, energy: 0 };
  const a = counterRows(p, { partner: false });
  assert.deepEqual(a.top.map((r) => r.key), ['poison', 'tax']);
  assert.ok(!a.rest.some((r) => r.key === 'tax2'), 'kein tax2 ohne Partner');
  assert.equal(a.top.length + a.rest.length, COUNTER_KEYS.length - 1);
  const b = counterRows(p, { partner: true });
  assert.ok(b.top.some((r) => r.key === 'tax2'), 'tax2 hängt am Pin von tax');
});

test('counterRows: aktive Zähler rutschen hoch (vor nur angepinnte), max aus Engine', () => {
  const max = { poison: POISON_MAX, ...COUNTER_MAX };
  const { top, rest } = counterRows({ poison: 0, tax: 0, energy: 2 }, { pins: ['poison', 'tax'], max });
  assert.deepEqual(top.map((r) => r.key), ['energy', 'poison', 'tax']);
  assert.equal(top.find((r) => r.key === 'poison').max, POISON_MAX);
  assert.ok(!rest.some((r) => r.key === 'energy'));
});

test('counterRows: leere Pins ⇒ nur Aktive oben; ungültige Pins ⇒ Standard', () => {
  assert.deepEqual(counterRows({}, { pins: [] }).top, []);
  assert.deepEqual(counterRows({}, { pins: null }).top.map((r) => r.key), DEFAULT_PINS);
});

test('togglePin: an/aus, Reihenfolge bleibt, keine Dubletten', () => {
  assert.deepEqual(togglePin(['poison', 'tax'], 'energy'), ['poison', 'tax', 'energy']);
  assert.deepEqual(togglePin(['poison', 'tax'], 'poison'), ['tax']);
  assert.deepEqual(togglePin(['tax', 'tax'], 'rad'), ['tax', 'rad']);
  assert.deepEqual(togglePin(null, 'tax'), ['poison']);
});

test('rollText: Würfel, Pasch, Münze, Spieler', () => {
  const L = de.rand;
  assert.deepEqual(rollText({ kind: 'w6', values: [1] }, L), { big: '1', sub: L.ouch });
  assert.deepEqual(rollText({ kind: 'w6', values: [6] }, L), { big: '6', sub: L.six });
  assert.deepEqual(rollText({ kind: 'w6x2', values: [3, 3] }, L), { big: '6', sub: L.double });
  assert.equal(rollText({ kind: 'w6x2', values: [2, 5] }, L).sub, '2 und 5');
  assert.deepEqual(rollText({ kind: 'w20', values: [20] }, L), { big: '20', sub: L.nat20 });
  assert.equal(rollText({ kind: 'coin', values: [0] }, L).big, 'Kopf');
  assert.equal(rollText({ kind: 'coin', values: [1] }, L).big, 'Zahl');
  assert.equal(rollText({ kind: 'player', values: [2], winnerSeat: 2 }, L, (s) => `Sitz${s}`).big, 'Sitz2');
});

test('logText: Einträge aus engine.history als Text', () => {
  const names = { a: 'Ana', b: 'Ben', c: 'Cem' };
  let s = createGame({ players: [{ id: 'a', name: 'Ana', seat: 1 }, { id: 'b', name: 'Ben', seat: 2 }, { id: 'c', name: 'Cem', seat: 3 }], startingLife: 40, firstSeat: 1, startedAt: 0 });
  const run = (a) => { s = act(s, a, { actor: 'a' }).state; };
  run({ type: 'life', target: 'a', d: -1 }); run({ type: 'life', target: 'a', d: -1 });
  run({ type: 'poison', target: 'b', d: 2 });
  run({ type: 'flag', target: 'c', key: 'monarch' });
  run({ type: 'storm', d: 2 });
  run({ type: 'endTurn', at: 60000 });
  run({ type: 'roll', kind: 'w20', values: [17] });
  run({ type: 'eliminate', target: 'b', by: null });
  const name = (x, kind) => (kind === 'seat' ? names[['', 'a', 'b', 'c'][x]] : names[x]);
  const lines = history(s).map((en) => logText(en, de.log, name, (k) => k));
  assert.deepEqual(lines, [
    'Ana −2 Leben',
    'Ben: +2 Gift',
    'Cem wird Monarch',
    'Sturm 2',
    'Ana beendet den Zug',
    'W20: 17',
    'Ben scheidet aus · Platz 3 · aufgegeben',
  ]);
});

test('lowLife: ≤ 10 und nicht ausgeschieden', () => {
  assert.equal(lowLife({ life: 10, out: false }), true);
  assert.equal(lowLife({ life: 11, out: false }), false);
  assert.equal(lowLife({ life: 3, out: true }), false);
  assert.equal(lowLife(null), false);
});

test('critical: Leben ≤ 10, Gift ≥ 7 oder Commander-Schaden ≥ 15 (nicht bei Ausgeschiedenen)', () => {
  assert.equal(critical({ life: CRIT.life, poison: 0, cmdMax: 0 }), true);
  assert.equal(critical({ life: 40, poison: CRIT.poison, cmdMax: 0 }), true);
  assert.equal(critical({ life: 40, poison: 0, cmdMax: CRIT.cmd }), true);
  assert.equal(critical({ life: 40, poison: 6, cmdMax: 14 }), false);
  assert.equal(critical({ life: 0, poison: 0, cmdMax: 0, out: true }), false);
  assert.equal(critical(undefined), false);
});

test('shortCmd / cmdLine: Beiname weg, Partner mit &', () => {
  assert.equal(shortCmd('Thrasios, Triton Hero'), 'Thrasios');
  assert.equal(shortCmd('Tymna the Weaver'), 'Tymna the Weaver');
  assert.equal(cmdLine({ commander_name: 'Tymna the Weaver', partner_name: 'Thrasios, Triton Hero' }), 'Tymna the Weaver & Thrasios');
  assert.equal(cmdLine({ commander_name: 'Edgar Markov' }), 'Edgar Markov');
  assert.equal(cmdLine(null), '');
});

test('byPlace sortiert nach Platz, ohne Eingabe zu ändern', () => {
  const rows = [{ id: 'a', place: 2 }, { id: 'b', place: 1 }, { id: 'c', place: 3 }];
  assert.deepEqual(byPlace(rows).map((r) => r.id), ['b', 'a', 'c']);
  assert.equal(rows[0].id, 'a');
});

test('flickerValue bleibt im Wertebereich der Wurfart', () => {
  for (let i = 0; i < 60; i++) {
    const w6 = Number(flickerValue('w6', i)); assert.ok(w6 >= 1 && w6 <= 6);
    const w2 = Number(flickerValue('w6x2', i)); assert.ok(w2 >= 2 && w2 <= 12);
    const w20 = Number(flickerValue('w20', i)); assert.ok(w20 >= 1 && w20 <= 20);
    assert.ok([0, 1].includes(flickerValue('coin', i)));
    const pl = flickerValue('player', i, 4); assert.ok(pl >= 0 && pl < 4);
  }
});

test('secondsSince: nie negativ', () => {
  assert.equal(secondsSince(1000, 62000), 61);
  assert.equal(secondsSince(5000, 1000), 0);
  assert.equal(secondsSince(NaN, 1000), 0);
});
