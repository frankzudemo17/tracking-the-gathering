// Spec P3: Spiel-Engine. Jeder Fall lädt das Modul selbst per import() — so bleibt die Datei
// auch ohne src/game/ ladbar und jeder Fall schlägt einzeln fehl (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/game/engine.js');

/** Feste Pseudo-Zufallsquelle (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const PLAYERS = [
  { id: 'A', name: 'Anna', seat: 0, partner: false },
  { id: 'B', name: 'Ben', seat: 1, partner: false },
  { id: 'C', name: 'Cem', seat: 2, partner: false },
  { id: 'D', name: 'Dana', seat: 3, partner: true },
];

/** Tisch mit Buchführung: t.do(action, actor) führt aus und merkt sich die Ereignisse. */
function table(E, opts = {}) {
  const init = E.createGame({ players: PLAYERS, startingLife: 40, firstSeat: 0, startedAt: 0, ...opts });
  const t = {
    init, s: init, all: [], last: [],
    do(action, actor = 'A') {
      const r = E.act(t.s, action, { actor });
      t.s = r.state; t.last = r.events; t.all.push(...r.events);
      return r.events;
    },
    p(id) { return t.s.players.find((x) => x.id === id); },
  };
  return t;
}

// ---------------------------------------------------------------------------
// Tödlich

test('E1 21 Commander-Schaden ist tödlich', async () => {
  const E = await load(); const t = table(E);
  for (let i = 0; i < 3; i++) t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'cmd', amount: 7 });
  assert.equal(t.p('B').cmd.A, 21);
  assert.equal(t.p('B').life, 19);
  assert.equal(E.isLethal(t.p('B')), true);
});

test('E2 20 Commander-Schaden ist nicht tödlich', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'cmd', amount: 20 });
  assert.equal(E.isLethal(t.p('B')), false);
});

test('E3 Partner-Commander zählen getrennt', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'D', to: ['A'], kind: 'cmd', amount: 11 }, 'D');
  t.do({ type: 'attack', from: 'D', to: ['A'], kind: 'cmd2', amount: 10 }, 'D');
  assert.equal(t.p('A').cmd.D, 11);
  assert.equal(t.p('A').cmd['D#2'], 10);
  assert.equal(E.isLethal(t.p('A')), false);
  assert.equal(t.p('A').life, 19);
});

test('E4 10 Gift ist tödlich', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'poison', target: 'B', d: 10 });
  assert.equal(E.isLethal(t.p('B')), true);
  const t2 = table(E);
  t2.do({ type: 'poison', target: 'B', d: 9 });
  assert.equal(E.isLethal(t2.p('B')), false);
});

test('E5 Gift wird bei 10 geklammert, Ereignis trägt den tatsächlichen Betrag', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'poison', target: 'B', d: 8 });
  const ev = t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'poison', amount: 5 });
  assert.equal(t.p('B').poison, 10);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].amount, 2);
  assert.equal(t.p('B').poisonFrom.A, 2);
});

test('E6 Leben 0 ist tödlich, 1 nicht', async () => {
  const E = await load();
  const t = table(E); t.do({ type: 'life', target: 'B', d: -40 });
  assert.equal(E.isLethal(t.p('B')), true);
  const t2 = table(E); t2.do({ type: 'life', target: 'B', d: -39 });
  assert.equal(E.isLethal(t2.p('B')), false);
});

// ---------------------------------------------------------------------------
// Angriff

test('E7 Lifelink gegen alle Gegner', async () => {
  const E = await load(); const t = table(E);
  const ev = t.do({ type: 'attack', from: 'A', to: ['B', 'C', 'D'], kind: 'damage', amount: 3, lifelink: true });
  for (const id of ['B', 'C', 'D']) assert.equal(t.p(id).life, 37);
  assert.equal(t.p('A').life, 49);
  assert.equal(ev.length, 4);
  assert.deepEqual(ev.map((e) => e.type), ['damage', 'damage', 'damage', 'lifelink']);
  assert.equal(ev[3].amount, 9);
  assert.equal(new Set(ev.map((e) => e.payload.act)).size, 1);
});

test('E8 kein Lifelink bei Gift', async () => {
  const E = await load(); const t = table(E);
  const ev = t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'poison', amount: 2, lifelink: true });
  assert.equal(t.p('A').life, 40);
  assert.equal(ev.filter((e) => e.type === 'lifelink').length, 0);
});

test('E9 Undo eines Angriffs ist atomar', async () => {
  const E = await load(); const t = table(E);
  const ev = t.do({ type: 'attack', from: 'A', to: ['B', 'C', 'D'], kind: 'damage', amount: 3, lifelink: true });
  const un = t.do({ type: 'undo' });
  for (const id of ['A', 'B', 'C', 'D']) assert.equal(t.p(id).life, 40);
  assert.equal(un.length, 4);
  assert.ok(un.every((e) => e.type === 'undo'));
  assert.deepEqual(un.map((e) => e.payload.seq).sort(), ev.map((e) => e.seq).sort());
  assert.deepEqual(t.p('B').dmgFrom, {});
});

test('E10 Undo ohne Null-Key-Fehler, Aktion für Aktion bis zum Start', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'life', target: 'A', d: -1 });
  t.do({ type: 'flag', target: 'B', key: 'monarch' });
  t.do({ type: 'undo' });
  assert.equal(t.p('B').monarch, false);
  assert.equal(t.p('A').life, 39);
  t.do({ type: 'undo' });
  assert.equal(t.p('A').life, 40);
  assert.equal(E.canUndo(t.s), false);
  const ev = t.do({ type: 'undo' });
  assert.equal(ev.length, 0);
  assert.equal(E.canUndo(t.s), false);
});

test('E11 Sturm läuft über Ereignisse und ist rückgängig zu machen', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'storm', d: 1 });
  t.do({ type: 'storm', d: 1 });
  t.do({ type: 'undo' });
  assert.equal(t.s.storm, 1);
});

test('E12 Zugende setzt Sturm zurück, Undo stellt Sturm, Zug und Zugbeginn her', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'storm', d: 2 });
  const ev = t.do({ type: 'endTurn', at: 90000 });
  assert.equal(t.s.storm, 0);
  assert.equal(t.s.turn, 1);
  assert.equal(ev[0].payload.seconds, 90);
  assert.equal(t.s.turnStartedAt, 90000);
  t.do({ type: 'undo' });
  assert.equal(t.s.storm, 2);
  assert.equal(t.s.turn, 0);
  assert.equal(t.s.turnStartedAt, 0);
});

// ---------------------------------------------------------------------------
// Zug und Ausscheiden

test('E13 Runde zählt beim Erreichen des Startsitzes', async () => {
  const E = await load(); const t = table(E, { firstSeat: 2 });
  assert.equal(t.s.turn, 2);
  assert.equal(t.s.round, 1);
  const turns = [], rounds = [];
  for (let i = 0; i < 4; i++) { t.do({ type: 'endTurn', at: (i + 1) * 1000 }); turns.push(t.s.turn); rounds.push(t.s.round); }
  assert.deepEqual(turns, [3, 0, 1, 2]);
  assert.deepEqual(rounds, [1, 1, 1, 2]);
});

test('E14 Ausgeschiedene werden beim Zugwechsel übersprungen', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 1000 });
  t.do({ type: 'eliminate', target: 'C', by: null });
  assert.equal(t.s.turn, 1);
  t.do({ type: 'endTurn', at: 2000 });
  assert.equal(t.s.turn, 3);
});

test('E15 Plätze beim Ausscheiden, letzter Lebender gewinnt', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'eliminate', target: 'D', by: 'B' });
  t.do({ type: 'eliminate', target: 'C', by: 'A' });
  t.do({ type: 'eliminate', target: 'B', by: 'A' });
  assert.equal(t.p('D').place, 4);
  assert.equal(t.p('C').place, 3);
  assert.equal(t.p('B').place, 2);
  assert.equal(t.p('A').place, 1);
  assert.equal(t.s.finished, true);
  assert.equal(t.p('D').outBy, 'B');
});

test('E16 wer am Zug ausscheidet, gibt den Zug weiter', async () => {
  const E = await load(); const t = table(E);
  assert.equal(t.s.turn, 0);
  t.do({ type: 'eliminate', target: 'A', by: 'B' });
  assert.equal(t.s.turn, 1);
});

test('E17 gleichzeitig tödlich: beide in Sitzreihenfolge', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'life', target: 'B', d: -38 });
  t.do({ type: 'life', target: 'C', d: -37 });
  const prev = t.s;
  t.do({ type: 'attack', from: 'A', to: ['D', 'C', 'B'], kind: 'damage', amount: 3 });
  assert.deepEqual(E.newlyLethal(prev, t.s), ['B', 'C']);
});

// ---------------------------------------------------------------------------
// Zähler und Status

test('E18 Zähler werden geklammert, Änderung 0 erzeugt kein Ereignis', async () => {
  const E = await load(); const t = table(E);
  const sp = t.do({ type: 'counter', target: 'A', key: 'speed', d: 5 });
  assert.equal(t.p('A').speed, 4);
  assert.equal(sp[0].amount, 4);
  t.do({ type: 'counter', target: 'A', key: 'ring', d: 5 });
  assert.equal(t.p('A').ring, 4);
  const tx = t.do({ type: 'counter', target: 'A', key: 'tax', d: -1 });
  assert.equal(tx.length, 0);
  assert.equal(t.p('A').tax, 0);
});

test('E19 Monarch ist exklusiv', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'flag', target: 'A', key: 'monarch' });
  t.do({ type: 'flag', target: 'B', key: 'monarch' });
  assert.equal(t.p('A').monarch, false);
  assert.equal(t.p('B').monarch, true);
});

// ---------------------------------------------------------------------------
// Vorschau

test('E20 Vorschau entspricht dem Ergebnis (50 zufällige Angriffe) und handgerechneten Werten', async () => {
  const E = await load();
  // handgerechnete Sollwerte (nicht über act abgeleitet)
  {
    const t = table(E);
    const pv = E.previewAttack(t.s, { from: 'A', to: ['B'], kind: 'cmd', amount: 7 });
    assert.deepEqual(pv.targets, [{ id: 'B', life: [40, 33], cmd: [0, 7, 21], lethal: false }]);
    assert.equal(pv.lifelinkGain, 0);
    t.do({ type: 'poison', target: 'C', d: 8 });
    const pg = E.previewAttack(t.s, { from: 'A', to: ['C'], kind: 'poison', amount: 5, lifelink: true });
    assert.deepEqual(pg.targets, [{ id: 'C', life: [40, 40], poison: [8, 10, 10], lethal: true }]);
    assert.equal(pg.lifelinkGain, 0);
    const pl = E.previewAttack(t.s, { from: 'A', to: ['B', 'C', 'D'], kind: 'damage', amount: 3, lifelink: true });
    assert.deepEqual(pl.targets.map((r) => r.life), [[40, 37], [40, 37], [40, 37]]);
    assert.equal(pl.lifelinkGain, 9);
    const p2 = E.previewAttack(t.s, { from: 'D', to: ['A'], kind: 'cmd2', amount: 21 });
    assert.deepEqual(p2.targets, [{ id: 'A', life: [40, 19], cmd: [0, 21, 21], lethal: true }]);
  }
  // 50 zufällige Angriffe
  const rand = prng(20);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const t = table(E);
  const ids = ['A', 'B', 'C', 'D'];
  let checked = 0;
  for (let i = 0; i < 50; i++) {
    const from = pick(ids);
    const to = ids.filter(() => rand() < 0.6);
    const kind = pick(['damage', 'cmd', 'cmd2', 'poison']);
    const a = { from, to, kind, amount: 1 + Math.floor(rand() * 8), lifelink: rand() < 0.4 };
    const before = deepFreeze(t.s);
    const pv = E.previewAttack(before, a);
    const after = E.act(before, { type: 'attack', ...a }).state;
    const key = kind === 'cmd2' ? `${from}#2` : from;
    for (const row of pv.targets) {
      const q = after.players.find((x) => x.id === row.id);
      assert.deepEqual(row.life[1], q.life);
      if (row.cmd) assert.equal(row.cmd[1], q.cmd[key] || 0);
      if (row.poison) assert.equal(row.poison[1], q.poison);
      assert.equal(row.lethal, E.isLethal(q));
      checked++;
    }
    const gain = after.players.find((x) => x.id === from).life - before.players.find((x) => x.id === from).life;
    assert.equal(pv.lifelinkGain, gain);
    t.s = after;
    // Leben gelegentlich zurücksetzen, damit das Spiel nicht nur aus Toten besteht
    if (i % 10 === 9) t.s = E.createGame({ players: PLAYERS, startingLife: 40, firstSeat: 0, startedAt: 0 });
  }
  assert.ok(checked > 30, `nur ${checked} Ziele geprüft`);
});

// ---------------------------------------------------------------------------
// Spielende

test('E21 nach Spielende keine Ereignisse, Undo macht das letzte Ausscheiden rückgängig', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'eliminate', target: 'D', by: 'B' });
  t.do({ type: 'eliminate', target: 'C', by: 'A' });
  t.do({ type: 'eliminate', target: 'B', by: 'A' });
  assert.equal(t.s.finished, true);
  assert.equal(t.do({ type: 'life', target: 'A', d: 1 }).length, 0);
  assert.equal(t.p('A').life, 40);
  const un = t.do({ type: 'undo' });
  assert.equal(un.length, 1);
  assert.equal(t.s.finished, false);
  assert.equal(t.p('B').out, false);
  assert.equal(t.p('B').place, null);
  assert.equal(t.p('A').place, null);
  assert.equal(t.p('C').place, 3);
});

// ---------------------------------------------------------------------------
// Verlauf

test('E22 Verlauf summiert aufeinanderfolgende Lebensänderungen', async () => {
  const E = await load(); const t = table(E);
  for (let i = 0; i < 5; i++) t.do({ type: 'life', target: 'A', d: -1 });
  t.do({ type: 'life', target: 'B', d: 1 });
  t.do({ type: 'life', target: 'A', d: -1 });
  const h = E.history(t.s);
  assert.deepEqual(h.map((e) => [e.type, e.targets, e.amount]), [['life', ['A'], -5], ['life', ['B'], 1], ['life', ['A'], -1]]);
});

test('E23 Verlauf ohne rückgängig gemachte Aktionen', async () => {
  const E = await load(); const t = table(E);
  for (let i = 0; i < 3; i++) t.do({ type: 'life', target: 'A', d: -1 });
  t.do({ type: 'undo' });
  const h = E.history(t.s);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].type, h[0].targets, h[0].amount], ['life', ['A'], -2]);
});

// ---------------------------------------------------------------------------
// Wer war es, Ergebnis

test('E24 killerCandidates sortiert nach Schaden, dann Gift', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'damage', amount: 12 });
  t.do({ type: 'attack', from: 'C', to: ['B'], kind: 'cmd', amount: 5 }, 'C');
  t.do({ type: 'attack', from: 'D', to: ['B'], kind: 'poison', amount: 3 }, 'D');
  const k = E.killerCandidates(t.s, 'B');
  assert.deepEqual(k.map((x) => x.id), ['A', 'C', 'D']);
  assert.equal(k[0].top, true);
  assert.equal(k[1].top, false);
  assert.equal(k[2].top, false);
});

test('E25 results: Lebende nach Leben, Gleichstand nach Sitz', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'life', target: 'A', d: -10 });
  t.do({ type: 'life', target: 'B', d: -10 });
  t.do({ type: 'life', target: 'C', d: -20 });
  t.do({ type: 'life', target: 'D', d: -30 });
  const r = E.results(t.s);
  assert.deepEqual(r.map((x) => [x.id, x.place, x.finalLife]), [['A', 1, 30], ['B', 2, 30], ['C', 3, 20], ['D', 4, 10]]);
});

test('E26 cmd2 ohne Partner erzeugt keine Ereignisse', async () => {
  const E = await load(); const t = table(E);
  assert.equal(t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'cmd2', amount: 3 }).length, 0);
  assert.equal(t.p('B').life, 40);
});

test('E27 Angriff auf sich selbst und Ausgeschiedene wird verworfen', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'eliminate', target: 'C', by: null });
  assert.equal(t.do({ type: 'attack', from: 'A', to: ['A', 'C'], kind: 'damage', amount: 3, lifelink: true }).length, 0);
  assert.equal(t.p('A').life, 40);
});

test('E28 turn_end trägt den Spieler am Zug als actor und target', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 30000 });
  const ev = t.do({ type: 'endTurn', at: 75400 }, 'A');
  assert.equal(ev[0].actor, 'B');
  assert.equal(ev[0].target, 'B');
  assert.equal(ev[0].payload.seconds, 45);
});

// ---------------------------------------------------------------------------
// Kriterium 5: Feldbelegung je Zeile der Tabelle

test('Feldbelegung je Ereignistyp', async () => {
  const E = await load(); const t = table(E);
  const one = (action, actor = 'C') => { const ev = t.do(action, actor); assert.equal(ev.length >= 1, true, JSON.stringify(action)); return ev; };
  const fields = (e) => ({ type: e.type, actor: e.actor, source: e.source, target: e.target, amount: e.amount, payload: e.payload });
  let ev;
  ev = one({ type: 'life', target: 'B', d: -3 });
  assert.deepEqual(fields(ev[0]), { type: 'life', actor: 'C', source: null, target: 'B', amount: -3, payload: { act: ev[0].payload.act } });
  ev = one({ type: 'attack', from: 'A', to: ['B', 'D'], kind: 'damage', amount: 2, lifelink: true });
  const a1 = ev[0].payload.act;
  assert.deepEqual(ev.map(fields), [
    { type: 'damage', actor: 'C', source: 'A', target: 'B', amount: 2, payload: { act: a1 } },
    { type: 'damage', actor: 'C', source: 'A', target: 'D', amount: 2, payload: { act: a1 } },
    { type: 'lifelink', actor: 'C', source: 'A', target: 'A', amount: 4, payload: { act: a1 } },
  ]);
  ev = one({ type: 'attack', from: 'D', to: ['A'], kind: 'cmd', amount: 4 });
  assert.deepEqual(fields(ev[0]), { type: 'cmd_damage', actor: 'C', source: 'D', target: 'A', amount: 4, payload: { partner: false, act: ev[0].payload.act } });
  ev = one({ type: 'attack', from: 'D', to: ['A'], kind: 'cmd2', amount: 5 });
  assert.deepEqual(fields(ev[0]), { type: 'cmd_damage', actor: 'C', source: 'D', target: 'A', amount: 5, payload: { partner: true, act: ev[0].payload.act } });
  ev = one({ type: 'attack', from: 'B', to: ['A'], kind: 'poison', amount: 3 });
  assert.deepEqual(fields(ev[0]), { type: 'poison', actor: 'C', source: 'B', target: 'A', amount: 3, payload: { act: ev[0].payload.act } });
  ev = one({ type: 'counter', target: 'A', key: 'energy', d: 2 });
  assert.deepEqual(fields(ev[0]), { type: 'counter', actor: 'C', source: null, target: 'A', amount: 2, payload: { key: 'energy', act: ev[0].payload.act } });
  ev = one({ type: 'poison', target: 'A', d: -1 });
  assert.deepEqual(fields(ev[0]), { type: 'poison', actor: 'C', source: null, target: 'A', amount: -1, payload: { act: ev[0].payload.act } });
  ev = one({ type: 'flag', target: 'B', key: 'init' });
  assert.deepEqual(fields(ev[0]), { type: 'flag', actor: 'C', source: null, target: 'B', amount: null, payload: { key: 'init', value: true, act: ev[0].payload.act } });
  ev = one({ type: 'global', key: 'daynight', value: 'nacht' });
  assert.deepEqual(fields(ev[0]), { type: 'global', actor: 'C', source: null, target: null, amount: null, payload: { key: 'daynight', value: 'nacht', act: ev[0].payload.act } });
  ev = one({ type: 'storm', d: 3 });
  assert.deepEqual(fields(ev[0]), { type: 'global', actor: 'C', source: null, target: null, amount: null, payload: { key: 'storm', value: 3, act: ev[0].payload.act } });
  ev = one({ type: 'endTurn', at: 12000 });
  assert.deepEqual(fields(ev[0]), { type: 'turn_end', actor: 'A', source: null, target: 'A', amount: null, payload: { seconds: 12, at: 12000, act: ev[0].payload.act } });
  ev = one({ type: 'eliminate', target: 'D', by: 'A' });
  assert.deepEqual(fields(ev[0]), { type: 'eliminate', actor: 'C', source: 'A', target: 'D', amount: null, payload: { place: 4, act: ev[0].payload.act } });
  ev = one({ type: 'eliminate', target: 'C', by: null });
  assert.deepEqual(fields(ev[0]), { type: 'eliminate', actor: 'C', source: null, target: 'C', amount: null, payload: { place: 3, act: ev[0].payload.act } });
  ev = one({ type: 'roll', kind: 'player', values: [1], winnerSeat: 1 });
  assert.deepEqual(fields(ev[0]), { type: 'roll', actor: 'C', source: null, target: null, amount: null, payload: { kind: 'player', values: [1], winner_seat: 1, act: ev[0].payload.act } });
  ev = one({ type: 'roll', kind: 'w20', values: [17] });
  assert.deepEqual(fields(ev[0]), { type: 'roll', actor: 'C', source: null, target: null, amount: null, payload: { kind: 'w20', values: [17], act: ev[0].payload.act } });
  const lastReal = t.all.filter((e) => e.type === 'eliminate').at(-1).seq;
  ev = one({ type: 'undo' });
  assert.deepEqual(fields(ev[0]), { type: 'undo', actor: 'C', source: null, target: null, amount: null, payload: { seq: lastReal, act: ev[0].payload.act } });
  // jedes Ereignis trägt alle acht Felder, round ist die Runde beim Eintragen
  for (const e of t.all) assert.deepEqual(Object.keys(e).sort(), ['actor', 'amount', 'payload', 'round', 'seq', 'source', 'target', 'type']);
  assert.ok(t.all.every((e) => e.round === 1));
});

// ---------------------------------------------------------------------------
// Kriterium 4: Determinismus

test('replay = inkrementell (500 zufällige Aktionen inkl. undo), seq lückenlos', async () => {
  const E = await load();
  const rand = prng(4711);
  const ids = ['A', 'B', 'C', 'D'];
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  let t = table(E);
  const count = { undo: 0, turn_end: 0, attack: 0, eliminate: 0, restart: 0 };
  let at = 0;
  let games = 0;
  const check = () => {
    const evs = JSON.parse(JSON.stringify(t.all));
    assert.deepEqual(E.replay(t.init, evs), t.s);
    assert.deepEqual(evs.map((e) => e.seq), evs.map((_, i) => i + 1));
  };
  for (let i = 0; i < 500; i++) {
    const r = rand();
    const target = pick(ids);
    let action;
    if (r < 0.15) action = { type: 'undo' };
    else if (r < 0.40) action = { type: 'attack', from: pick(ids), to: ids.filter(() => rand() < 0.5), kind: pick(['damage', 'cmd', 'cmd2', 'poison']), amount: 1 + Math.floor(rand() * 6), lifelink: rand() < 0.3 };
    else if (r < 0.55) action = { type: 'life', target, d: Math.floor(rand() * 9) - 4 };
    else if (r < 0.62) action = { type: 'counter', target, key: pick(['energy', 'exp', 'tax', 'tax2', 'rad', 'speed', 'ring', 'dungeon']), d: Math.floor(rand() * 7) - 3 };
    else if (r < 0.66) action = { type: 'poison', target, d: Math.floor(rand() * 5) - 2 };
    else if (r < 0.70) action = { type: 'flag', target, key: pick(['monarch', 'init', 'city']) };
    else if (r < 0.73) action = { type: 'global', key: 'daynight', value: pick([null, 'tag', 'nacht']) };
    else if (r < 0.77) action = { type: 'storm', d: Math.floor(rand() * 5) - 2 };
    else if (r < 0.92) { at += 1000 + Math.floor(rand() * 200000); action = { type: 'endTurn', at }; }
    else if (r < 0.96) action = { type: 'eliminate', target, by: rand() < 0.5 ? pick(ids) : null };
    else action = { type: 'roll', kind: 'w6', values: [1 + Math.floor(rand() * 6)] };
    const n = t.do(action, pick(ids)).length;
    if (n) {
      const k = action.type === 'endTurn' ? 'turn_end' : action.type;
      if (k in count) count[k]++;
    }
    // Ein beendetes Spiel wird mit 50 % rückgängig gemacht, sonst geht es mit einem neuen Spiel weiter
    if (t.s.finished && rand() < 0.5) {
      check(); games++; count.restart++;
      t = table(E);
    }
    if (i % 50 === 49) check();
  }
  check();
  assert.ok(count.undo >= 40, `undo ${count.undo}`);
  assert.ok(count.turn_end >= 40, `turn_end ${count.turn_end}`);
  assert.ok(count.attack >= 60, `attack ${count.attack}`);
  assert.ok(count.eliminate >= 5, `eliminate ${count.eliminate}`);
  assert.ok(games >= 0);
});

test('Undo über Zugende und Spielende hinweg; replay gleich dem Endzustand', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'storm', d: 3 });
  t.do({ type: 'endTurn', at: 5000 });
  t.do({ type: 'eliminate', target: 'B', by: 'A' });
  t.do({ type: 'eliminate', target: 'C', by: 'A' });
  t.do({ type: 'eliminate', target: 'D', by: 'A' });
  assert.equal(t.s.finished, true);
  for (let i = 0; i < 4; i++) t.do({ type: 'undo' });
  assert.equal(t.s.finished, false);
  assert.equal(t.s.turn, 0);
  assert.equal(t.s.storm, 3);
  assert.equal(t.s.turnStartedAt, 0);
  assert.ok(t.s.players.every((p) => !p.out && p.place == null));
  assert.deepEqual(E.replay(t.init, t.all), t.s);
  // replay nimmt auch die createGame-Eingabe und unsortierte Ereignisse
  assert.deepEqual(E.replay({ players: PLAYERS, startingLife: 40, firstSeat: 0, startedAt: 0 }, t.all.slice().reverse()), t.s);
});

test('apply schrittweise = act', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'A', to: ['B', 'C'], kind: 'damage', amount: 4, lifelink: true });
  t.do({ type: 'endTurn', at: 3000 });
  t.do({ type: 'undo' });
  t.do({ type: 'flag', target: 'C', key: 'monarch' });
  let s = t.init;
  for (const e of t.all) s = E.apply(s, e);
  assert.deepEqual(s, t.s);
});

// ---------------------------------------------------------------------------
// Reinheit und Negativraum

test('act und previewAttack verändern den Eingangszustand nicht', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'cmd', amount: 3 });
  t.do({ type: 'attack', from: 'C', to: ['B'], kind: 'poison', amount: 2 });
  const frozen = deepFreeze(t.s);
  const copy = JSON.parse(JSON.stringify(frozen));
  E.previewAttack(frozen, { from: 'A', to: ['B', 'C', 'D'], kind: 'cmd', amount: 2, lifelink: true });
  E.act(frozen, { type: 'attack', from: 'A', to: ['B', 'C', 'D'], kind: 'damage', amount: 2, lifelink: true }, { actor: 'A' });
  E.act(frozen, { type: 'attack', from: 'C', to: ['B'], kind: 'poison', amount: 2 }, { actor: 'A' });
  E.act(frozen, { type: 'flag', target: 'A', key: 'monarch' }, { actor: 'A' });
  E.act(frozen, { type: 'endTurn', at: 1000 }, { actor: 'A' });
  E.act(frozen, { type: 'undo' }, { actor: 'A' });
  E.act(frozen, { type: 'eliminate', target: 'B', by: 'A' }, { actor: 'A' });
  E.history(frozen); E.results(frozen); E.snapshot(frozen); E.killerCandidates(frozen, 'B');
  assert.deepEqual(JSON.parse(JSON.stringify(frozen)), copy);
});

test('createGame kopiert seine Eingabe und sortiert nach Sitz', async () => {
  const E = await load();
  const input = [{ id: 'X', name: 'x', seat: 1, partner: false }, { id: 'Y', name: 'y', seat: 0, partner: true }];
  const s = E.createGame({ players: input, startingLife: 20, firstSeat: 1, startedAt: 500 });
  input[0].id = 'Z';
  assert.deepEqual(s.players.map((p) => [p.id, p.seat, p.life]), [['Y', 0, 20], ['X', 1, 20]]);
  assert.equal(s.turn, 1); assert.equal(s.first, 1); assert.equal(s.round, 1); assert.equal(s.turnStartedAt, 500);
  assert.equal(s.nextSeq, 1); assert.equal(s.nextAct, 1);
});

test('rückgängig gemachte Ereignisse fehlen in newlyLethal und snapshot', async () => {
  const E = await load(); const t = table(E);
  const prev = t.s;
  t.do({ type: 'attack', from: 'D', to: ['A'], kind: 'cmd', amount: 21 }, 'D');
  t.do({ type: 'flag', target: 'A', key: 'monarch' });
  assert.deepEqual(E.newlyLethal(prev, t.s), ['A']);
  t.do({ type: 'undo' });
  t.do({ type: 'undo' });
  assert.deepEqual(E.newlyLethal(prev, t.s), []);
  const snap = E.snapshot(t.s);
  assert.deepEqual(snap.players[0], { id: 'A', seat: 0, life: 40, poison: 0, cmdMax: 0, out: false, place: null, monarch: false, init: false, city: false });
});

test('snapshot hat die festgelegte Form', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'D', to: ['B'], kind: 'cmd', amount: 6 }, 'D');
  t.do({ type: 'attack', from: 'D', to: ['B'], kind: 'cmd2', amount: 9 }, 'D');
  t.do({ type: 'global', key: 'daynight', value: 'tag' });
  const s = E.snapshot(t.s);
  assert.deepEqual(Object.keys(s).sort(), ['daynight', 'finished', 'first', 'players', 'round', 'storm', 'turn', 'turnStartedAt', 'v'].sort());
  assert.equal(s.v, 1);
  assert.equal(s.daynight, 'tag');
  assert.equal(s.players[1].cmdMax, 9);
  assert.equal(s.players[1].life, 25);
});

test('Ausgeschiedene: nicht als Ziel, aber als Kandidat; Ausscheiden doppelt erzeugt nichts', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'C', to: ['B'], kind: 'damage', amount: 5 }, 'C');
  t.do({ type: 'eliminate', target: 'C', by: null });
  assert.equal(t.do({ type: 'eliminate', target: 'C', by: 'A' }).length, 0);
  const k = E.killerCandidates(t.s, 'B');
  assert.deepEqual(k.map((x) => x.id), ['C', 'A', 'D']);
  assert.equal(k[0].top, true);
  const ev = t.do({ type: 'attack', from: 'A', to: ['B', 'C', 'D'], kind: 'damage', amount: 1 });
  assert.deepEqual(ev.map((e) => e.target), ['B', 'D']);
});

test('Angriffsmenge unter 1 und leere Zielliste erzeugen keine Ereignisse; Leben darf negativ werden', async () => {
  const E = await load(); const t = table(E);
  assert.equal(t.do({ type: 'attack', from: 'A', to: ['B'], kind: 'damage', amount: 0 }).length, 0);
  assert.equal(t.do({ type: 'attack', from: 'A', to: [], kind: 'damage', amount: 3 }).length, 0);
  assert.equal(t.do({ type: 'life', target: 'B', d: 0 }).length, 0);
  assert.equal(t.do({ type: 'storm', d: -1 }).length, 0);
  assert.equal(t.do({ type: 'global', key: 'daynight', value: null }).length, 0);
  t.do({ type: 'life', target: 'B', d: -45 });
  assert.equal(t.p('B').life, -5);
  assert.equal(t.all.length, 1);
});

test('Review: Runde zählt auch, wenn der Startsitz ausgeschieden ist (Main.dc.html:2077–2081)', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'eliminate', target: 'A', by: null });
  assert.deepEqual([t.s.turn, t.s.round], [1, 1]);
  t.do({ type: 'endTurn', at: 1000 });
  t.do({ type: 'endTurn', at: 2000 });
  assert.deepEqual([t.s.turn, t.s.round], [3, 1]);
  t.do({ type: 'endTurn', at: 3000 });
  assert.deepEqual([t.s.turn, t.s.round], [1, 2]);
});

test('Review: killerCandidates – bei gleichem Schaden entscheidet Gift, dann Sitz', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'attack', from: 'D', to: ['B'], kind: 'poison', amount: 3 }, 'D');
  t.do({ type: 'attack', from: 'C', to: ['B'], kind: 'poison', amount: 1 }, 'C');
  const k = E.killerCandidates(t.s, 'B');
  assert.deepEqual(k.map((x) => [x.id, x.damage, x.poison, x.top]), [['D', 0, 3, true], ['C', 0, 1, false], ['A', 0, 0, false]]);
});

test('Hinweis: replay von 2000 Ereignissen (Zeitmessung, kein harter Fall)', async () => {
  const E = await load(); const t = table(E);
  let at = 0;
  while (t.all.length < 2000) {
    t.do({ type: 'life', target: 'B', d: -1 });
    t.do({ type: 'life', target: 'B', d: 1 });
    t.do({ type: 'counter', target: 'A', key: 'energy', d: 1 });
    t.do({ type: 'undo' });
    at += 1000; t.do({ type: 'endTurn', at });
  }
  const t0 = performance.now();
  const s = E.replay(t.init, t.all);
  const ms = performance.now() - t0;
  console.log(`# replay ${t.all.length} Ereignisse: ${ms.toFixed(1)} ms`);
  assert.deepEqual(s, t.s);
});

// ---------------------------------------------------------------------------
// Spec P1 (Welle ttg-features): Messfehler „K.O. des Spielers am Zug“ — eliminate mit optionalem payload.at.
// Sollwerte von Hand: Sekunden = (at − Zugbeginn) / 1000 (spec-p1-zuguhr.md, Tabelle „Spec-Tests · Engine“).

/** Letzter turn_end der Ereignisliste. */
const lastTurnEnd = (t) => t.all.filter((e) => e.type === 'turn_end').at(-1);

test('P1 Z1 K.O. am Zug: Folgezug beginnt beim K.O. (at), nicht beim alten Zugbeginn', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 60000 });
  t.do({ type: 'eliminate', target: 'B', by: 'C', at: 150000 });
  assert.equal(t.s.turn, 2);
  assert.equal(t.s.turnStartedAt, 150000);
  t.do({ type: 'endTurn', at: 210000 });
  const te = lastTurnEnd(t);
  assert.equal(te.actor, 'C');
  assert.equal(te.payload.seconds, 60);
});

test('P1 Z2 K.O. nicht am Zug: Zugbeginn bleibt', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'eliminate', target: 'C', at: 30000 });
  assert.equal(t.s.turnStartedAt, 0);
  t.do({ type: 'endTurn', at: 90000 });
  const te = lastTurnEnd(t);
  assert.equal(te.actor, 'A');
  assert.equal(te.payload.seconds, 90);
});

test('P1 Z3 altes Ereignis ohne at: Verhalten wie bisher, payload ohne at', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 60000 });
  const ev = t.do({ type: 'eliminate', target: 'B', by: 'C' });
  assert.deepEqual(ev[0].payload, { place: 4, act: ev[0].payload.act });
  assert.equal('at' in ev[0].payload, false);
  assert.equal(t.s.turnStartedAt, 60000);
  t.do({ type: 'endTurn', at: 210000 });
  const te = lastTurnEnd(t);
  assert.equal(te.actor, 'C');
  assert.equal(te.payload.seconds, 150);
});

test('P1 Z4a Replay neuer Ereignisse (gemischt) ergibt denselben Zugbeginn', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'life', target: 'C', d: -3 });
  t.do({ type: 'endTurn', at: 60000 });
  t.do({ type: 'counter', target: 'B', key: 'energy', d: 2 }, 'B');
  t.do({ type: 'life', target: 'B', d: -40 }, 'B');
  t.do({ type: 'eliminate', target: 'B', by: 'C', at: 150000 });
  const s = E.replay(t.init, t.all);
  assert.equal(s.turn, 2);
  assert.equal(s.turnStartedAt, 150000);
  assert.deepEqual(s, t.s);
});

test('P1 Z4b Replay alter Ereignisse (ohne at) ergibt den alten Zugbeginn', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 60000 });
  t.do({ type: 'eliminate', target: 'B', by: 'C' });
  const s = E.replay(t.init, t.all);
  assert.equal(s.turnStartedAt, 60000);
  assert.equal(s.turn, 2);
});

test('P1 Z5 Rückgängig über das K.O.: B zurück, Zug und Zugbeginn wie vorher', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 60000 });
  t.do({ type: 'eliminate', target: 'B', by: 'C', at: 150000 });
  t.do({ type: 'undo' });
  assert.equal(t.p('B').out, false);
  assert.equal(t.s.turn, 1);
  assert.equal(t.s.turnStartedAt, 60000);
});

test('P1 Z6 Uhr-Versatz: at vor dem Zugbeginn ⇒ Zugbeginn bleibt (Math.max)', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 60000 });
  t.do({ type: 'eliminate', target: 'B', at: 50000 });
  assert.equal(t.s.turnStartedAt, 60000);
  t.do({ type: 'endTurn', at: 120000 });
  const te = lastTurnEnd(t);
  assert.equal(te.actor, 'C');
  assert.equal(te.payload.seconds, 60);
});

test('P1 Z7 Spielende durch K.O.: Zugbeginn unverändert', async () => {
  const E = await load();
  const init = E.createGame({ players: [
    { id: 'X', name: 'Xaver', seat: 0, partner: false },
    { id: 'Y', name: 'Yara', seat: 1, partner: false },
  ], startingLife: 40, firstSeat: 0, startedAt: 0 });
  const r = E.act(init, { type: 'eliminate', target: 'X', at: 40000 }, { actor: 'Y' });
  const s = r.state;
  assert.equal(s.finished, true);
  assert.equal(s.players.find((p) => p.id === 'Y').place, 1);
  assert.equal(s.turn, 0);
  assert.equal(s.turnStartedAt, 0);
});

test('P1 Z8 ungültiges at: kein Wurf, kein at im payload, Zugbeginn bleibt', async () => {
  const E = await load();
  for (const at of [NaN, Infinity, '150000', null]) {
    const t = table(E);
    t.do({ type: 'endTurn', at: 60000 });
    let ev;
    assert.doesNotThrow(() => { ev = t.do({ type: 'eliminate', target: 'B', by: 'C', at }); }, `at=${String(at)}`);
    assert.deepEqual(ev[0].payload, { place: 4, act: ev[0].payload.act }, `at=${String(at)}`);
    assert.equal('at' in ev[0].payload, false, `at=${String(at)}`);
    assert.equal(t.s.turnStartedAt, 60000, `at=${String(at)}`);
  }
});

test('P1 Z9 Feldbelegung eliminate mit at', async () => {
  const E = await load(); const t = table(E);
  const ev = t.do({ type: 'eliminate', target: 'D', by: 'A', at: 12345 });
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].payload, { place: 4, at: 12345, act: ev[0].payload.act });
});

test('P1 Z10 zwei K.O. hintereinander am Zug: Folgezug ab dem zweiten K.O.', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 60000 });
  t.do({ type: 'eliminate', target: 'B', at: 100000 });
  t.do({ type: 'eliminate', target: 'C', at: 130000 });
  t.do({ type: 'endTurn', at: 160000 });
  assert.equal(t.s.turn, 0);
  const te = lastTurnEnd(t);
  assert.equal(te.actor, 'D');
  assert.equal(te.payload.seconds, 30);
});

test('P1 Z11 K.O. am Zug beim Rundenwechsel', async () => {
  const E = await load(); const t = table(E);
  t.do({ type: 'endTurn', at: 1000 });
  t.do({ type: 'endTurn', at: 2000 });
  t.do({ type: 'endTurn', at: 3000 });
  assert.equal(t.s.turn, 3);
  t.do({ type: 'eliminate', target: 'D', at: 9000 });
  assert.equal(t.s.turn, 0);
  assert.equal(t.s.round, 2);
  assert.equal(t.s.turnStartedAt, 9000);
  t.do({ type: 'endTurn', at: 10000 });
  const te = lastTurnEnd(t);
  assert.equal(te.actor, 'A');
  assert.equal(te.payload.seconds, 1);
});
