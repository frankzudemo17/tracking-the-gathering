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

// ---------- Treffer (Spec P13, Entscheid 6 und 12): dynamischer Import, damit die neuen Tests am
// Start-main rot sind (Export fehlt), statt die ganze Datei am Laden scheitern zu lassen.
const hit = () => import('../../src/views/life-ui.js');

test('P13 hitStep: ein Tipp, großer Einzeltreffer, knapp darunter', async () => {
  const { hitStep, HIT_BIG } = await hit();
  assert.equal(HIT_BIG, 10);
  assert.deepEqual(hitStep(null, -1, 0), { level: 'dmg', acc: { sum: 1, at: 0 } });
  assert.equal(hitStep(null, -10, 0).level, 'big');
  assert.equal(hitStep(null, -9, 0).level, 'dmg');
});

test('P13 hitStep: Tippserie — Schritte 1–9 dmg, 10 big, 11 (1000 ms) big', async () => {
  const { hitStep } = await hit();
  let acc = null; const lv = [];
  for (let i = 0; i <= 10; i++) { const r = hitStep(acc, -1, i * 100); acc = r.acc; lv.push(r.level); }
  assert.deepEqual(lv, [...Array(9).fill('dmg'), 'big', 'big']);
  assert.equal(acc.sum, 11);
});

test('P13 hitStep: Fenster abgelaufen (1800 außerhalb), gerade noch (1799), verlängert', async () => {
  const { hitStep } = await hit();
  const a = hitStep(null, -9, 0).acc;
  const out = hitStep(a, -1, 1800);
  assert.equal(out.level, 'dmg'); assert.equal(out.acc.sum, 1);
  assert.equal(hitStep(a, -1, 1799).level, 'big');
  const b = hitStep(hitStep(null, -5, 0).acc, -4, 1500).acc;
  assert.equal(hitStep(b, -1, 3000).level, 'big');
});

test('P13 hitStep: Gewinn ⇒ gain, acc null; Gewinn setzt zurück', async () => {
  const { hitStep } = await hit();
  assert.deepEqual(hitStep(null, 1, 0), { level: 'gain', acc: null });
  assert.deepEqual(hitStep(null, 25, 0), { level: 'gain', acc: null });
  const a = hitStep(null, -9, 0).acc;
  const g = hitStep(a, 1, 100);
  const r = hitStep(g.acc, -1, 200);
  assert.equal(r.level, 'dmg'); assert.equal(r.acc.sum, 1);
});

test('P13 hitStep: keine Änderung und Unsinn ⇒ level null, acc unverändert, kein Wurf', async () => {
  const { hitStep } = await hit();
  const acc = { sum: 4, at: 0 };
  const r = hitStep(acc, 0, 50);
  assert.equal(r.level, null); assert.deepEqual(r.acc, { sum: 4, at: 0 });
  for (const d of [NaN, undefined, 'x']) {
    const q = hitStep(acc, d, 50);
    assert.equal(q.level, null); assert.deepEqual(q.acc, { sum: 4, at: 0 });
  }
});

// hitDiff: drei Spieler a, b, c, Startleben 40 (Engine createGame/act)
const g0 = () => createGame({ players: [{ id: 'a', seat: 0 }, { id: 'b', seat: 1 }, { id: 'c', seat: 2 }], startingLife: 40 });
const step = (s, action) => act(s, action).state;
const tip = () => { const s0 = g0(); return [s0, step(s0, { type: 'life', target: 'a', d: -3 })]; };

test('P13 hitDiff: Tipp, Angriff, Commander-Schaden, Lebensverknüpfung', async () => {
  const { hitDiff } = await hit();
  const [s0, s1] = tip();
  assert.deepEqual(hitDiff(s0, s1), [{ id: 'a', d: -3 }]);
  assert.deepEqual(hitDiff(s0, step(s0, { type: 'attack', from: 'a', to: ['b'], kind: 'damage', amount: 12 })), [{ id: 'b', d: -12 }]);
  assert.deepEqual(hitDiff(s0, step(s0, { type: 'attack', from: 'a', to: ['b'], kind: 'cmd', amount: 5 })), [{ id: 'b', d: -5 }]);
  const ll = hitDiff(s0, step(s0, { type: 'attack', from: 'a', to: ['b'], kind: 'damage', amount: 4, lifelink: true }));
  assert.deepEqual(ll.slice().sort((x, y) => x.id.localeCompare(y.id)), [{ id: 'a', d: 4 }, { id: 'b', d: -4 }]);
});

test('P13 hitDiff: Gift, Zähler, Zugwechsel ⇒ leer', async () => {
  const { hitDiff } = await hit();
  const s0 = g0();
  assert.deepEqual(hitDiff(s0, step(s0, { type: 'poison', target: 'b', d: 1 })), []);
  assert.deepEqual(hitDiff(s0, step(s0, { type: 'counter', target: 'a', key: 'energy', d: 1 })), []);
  assert.deepEqual(hitDiff(s0, step(s0, { type: 'endTurn', at: 1000 })), []);
});

test('P13 hitDiff: Rückgängig still, auch mit Treffer im selben Übergang; gleicher Zustand leer', async () => {
  const { hitDiff } = await hit();
  const [, s1] = tip();
  const s2 = step(s1, { type: 'undo' });
  assert.notEqual(s2.players.find((p) => p.id === 'a').life, s1.players.find((p) => p.id === 'a').life);
  assert.deepEqual(hitDiff(s1, s2), []);
  const s3 = step(s2, { type: 'life', target: 'b', d: -2 });
  assert.deepEqual(hitDiff(s1, s3), []);
  assert.deepEqual(hitDiff(s1, s1), []);
});

test('P13 hitDiff: Gründe — local/remote pulsen, alles andere still', async () => {
  const { hitDiff } = await hit();
  const [s0, s1] = tip();
  for (const r of ['local', 'remote']) assert.deepEqual(hitDiff(s0, s1, r), [{ id: 'a', d: -3 }], r);
  for (const r of ['catchup', 'rebase', 'status', 'reload', 'irgendwas']) assert.deepEqual(hitDiff(s0, s1, r), [], r);
});

test('P13 hitDiff: Erstaufbau, neuer Spieler, ausgeschieden', async () => {
  const { hitDiff } = await hit();
  const [s0, s1] = tip();
  assert.deepEqual(hitDiff(null, s1), []);
  assert.deepEqual(hitDiff(undefined, s1), []);
  assert.deepEqual(hitDiff(s0, null), []);
  const neu = { ...s1, players: [...s1.players, { ...s1.players[0], id: 'd', life: 12 }] };
  assert.deepEqual(hitDiff(s0, neu), [{ id: 'a', d: -3 }]);
  const out = { ...s1, players: s1.players.map((p) => (p.id === 'b' ? { ...p, out: true, life: 0 } : p)) };
  assert.deepEqual(hitDiff(s0, out), [{ id: 'a', d: -3 }]);
});
