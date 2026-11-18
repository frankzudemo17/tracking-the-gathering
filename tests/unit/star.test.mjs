// P16 Star-Format: 5 Spieler, Feinde = die beiden Sitze gegenüber (+2/+3), Sieg sobald beide Feinde raus sind.
// Sollwerte von Hand aus dem Pentagramm (Sitz 0..4 im Uhrzeigersinn), nicht aus der Engine abgeleitet.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/game/engine.js');

const FIVE = ['A', 'B', 'C', 'D', 'E'].map((id, seat) => ({ id, name: id, seat }));

function star(E, { on = true, life = 40, players = FIVE } = {}) {
  let s = E.createGame({ players, startingLife: life, firstSeat: 0, startedAt: 0 });
  const all = [];
  const run = (a) => { const r = E.act(s, a); s = r.state; all.push(...r.events); return r; };
  if (on) run({ type: 'global', key: 'star', value: true });
  return { get s() { return s; }, all, run, out: (id) => run({ type: 'eliminate', target: id }) };
}

test('Star Feinde: Sitz +2 und +3, Nachbarn sind keine Feinde', async () => {
  const E = await load();
  const t = star(E);
  assert.deepEqual(E.starFoes(t.s, 'A'), ['C', 'D']);
  assert.deepEqual(E.starFoes(t.s, 'B'), ['D', 'E']);
  assert.deepEqual(E.starFoes(t.s, 'C'), ['A', 'E']);
  assert.deepEqual(E.starFoes(t.s, 'D'), ['A', 'B']);
  assert.deepEqual(E.starFoes(t.s, 'E'), ['B', 'C']);
  // Gegenprobe: ohne Star keine Feinde, unbekannte ID ⇒ []
  assert.deepEqual(E.starFoes(star(E, { on: false }).s, 'A'), []);
  assert.deepEqual(E.starFoes(t.s, 'X'), []);
});

test('Star Feinde folgen der Sitzreihenfolge, nicht der Eingabereihenfolge', async () => {
  const E = await load();
  const shuffled = [FIVE[3], FIVE[0], FIVE[4], FIVE[1], FIVE[2]];
  const t = star(E, { players: shuffled });
  assert.deepEqual(E.starFoes(t.s, 'A'), ['C', 'D']);
});

test('Star Sieg: beide Feinde raus ⇒ Spielende, Sieger Platz 1, Rest nach Leben ab Platz 2', async () => {
  const E = await load();
  const t = star(E);
  t.run({ type: 'life', target: 'B', d: -10 }); // B 30, E 40
  t.out('C');
  assert.equal(t.s.finished, false, 'ein Feind raus reicht nicht');
  t.out('D'); // A hat beide Feinde (C, D) raus
  assert.equal(t.s.finished, true);
  const r = Object.fromEntries(E.results(t.s).map((x) => [x.id, x.place]));
  assert.deepEqual(r, { A: 1, E: 2, B: 3, D: 4, C: 5 });
  // Plätze eindeutig 1..5 (finish_game verlangt das)
  assert.deepEqual(Object.values(r).sort(), [1, 2, 3, 4, 5]);
});

test('Star Gegenprobe: ohne Star endet das Spiel bei zwei K.O. nicht', async () => {
  const E = await load();
  const t = star(E, { on: false });
  t.out('C'); t.out('D');
  assert.equal(t.s.finished, false);
});

test('Star kein Sieg, solange niemand beide Feinde raus hat (B, E raus ⇒ weiter)', async () => {
  const E = await load();
  const t = star(E);
  t.out('B'); // B ist Feind von D und E
  t.out('E'); // E ist Feind von B und C ⇒ niemand hat beide Feinde raus (A: C,D; C: A,E; D: A,B)
  // D hat Feinde A,B: B raus, A lebt. C hat Feinde A,E: E raus, A lebt.
  assert.equal(t.s.finished, false);
  t.out('A'); // jetzt haben C (A,E) und D (A,B) beide Feinde raus ⇒ Doppelsieg
  assert.equal(t.s.finished, true);
});

test('Star Doppelsieg: mehr Leben gewinnt, Gleichstand ⇒ früherer Sitz', async () => {
  const E = await load();
  let t = star(E);
  t.run({ type: 'life', target: 'C', d: -5 }); // C 35, D 40
  t.out('B'); t.out('E'); t.out('A');
  let r = Object.fromEntries(E.results(t.s).map((x) => [x.id, x.place]));
  assert.equal(r.D, 1); assert.equal(r.C, 2);
  t = star(E);
  t.out('B'); t.out('E'); t.out('A');
  r = Object.fromEntries(E.results(t.s).map((x) => [x.id, x.place]));
  assert.equal(r.C, 1); assert.equal(r.D, 2);
});

test('Star Rückgängig: letzter K.O. zurück ⇒ Spiel läuft wieder, Star bleibt an', async () => {
  const E = await load();
  const t = star(E);
  t.out('C'); t.out('D');
  assert.equal(t.s.finished, true);
  t.run({ type: 'undo' });
  assert.equal(t.s.finished, false);
  assert.equal(t.s.star, true);
  assert.equal(t.s.players.find((p) => p.id === 'D').out, false);
});

test('Star Modus: nicht rückgängig machbar, nicht im Verlauf, Replay stellt ihn her', async () => {
  const E = await load();
  const t = star(E);
  assert.equal(t.s.star, true);
  assert.equal(E.canUndo(t.s), false);
  assert.equal(E.history(t.s).length, 0);
  const re = E.replay({ players: FIVE, startingLife: 40, firstSeat: 0, startedAt: 0 }, t.all);
  assert.equal(re.star, true);
  assert.deepEqual(E.starFoes(re, 'A'), ['C', 'D']);
});

test('Star Start: nur bei 5 Spielern, nur Wert true, nur einmal, nur vor der ersten Spielhandlung', async () => {
  const E = await load();
  const four = FIVE.slice(0, 4);
  assert.throws(() => star(E, { players: four }), /5 Spieler/);
  const t = star(E, { on: false });
  assert.throws(() => t.run({ type: 'global', key: 'star', value: 'ja' }), /Ungültiger Wert/);
  // nach Würfen erlaubt
  const u = star(E, { on: false });
  u.run({ type: 'roll', kind: 'start', values: [1, 2, 3, 4, 5], winnerSeat: 4 });
  assert.equal(u.run({ type: 'global', key: 'star', value: true }).events.length, 1);
  assert.equal(u.run({ type: 'global', key: 'star', value: true }).events.length, 0, 'zweites Mal ⇒ nichts');
  // nach einer Lebensänderung nicht mehr
  const v = star(E, { on: false });
  v.run({ type: 'life', target: 'A', d: -1 });
  assert.equal(v.run({ type: 'global', key: 'star', value: true }).events.length, 0);
  assert.equal(v.s.star, false);
});

test('Star Zugbeginn nach dem Intro bleibt möglich, wenn Star schon gesetzt ist', async () => {
  const E = await load();
  const t = star(E);
  const r = t.run({ type: 'global', key: 'turnStartedAt', value: 1234 });
  assert.equal(r.events.length, 1);
  assert.equal(t.s.turnStartedAt, 1234);
});

test('results ohne Star unverändert: Lebende ohne Platz bekommen die freien Plätze ab 1', async () => {
  const E = await load();
  const t = star(E, { on: false });
  t.run({ type: 'life', target: 'B', d: -3 });
  t.out('E');
  const r = Object.fromEntries(E.results(t.s).map((x) => [x.id, x.place]));
  assert.deepEqual(r, { A: 1, C: 2, D: 3, B: 4, E: 5 });
});

// Review B1: ein verspätetes K.O. (zweites Gerät, Sync) nach dem Star-Ende vergibt Platz 1 kein zweites Mal
test('Star nach Spielende: weiteres K.O. per Replay ⇒ Sieger bleibt allein auf Platz 1, Plätze eindeutig', async () => {
  const E = await load();
  const t = star(E);
  t.run({ type: 'life', target: 'E', d: 5 }); // E 45 > A 40
  t.out('C'); t.out('D'); // A gewinnt
  const late = { seq: 99, type: 'eliminate', round: 1, actor: null, source: null, target: 'B', amount: null, payload: { place: 3, act: 99 } };
  const re = E.replay({ players: FIVE, startingLife: 40, firstSeat: 0, startedAt: 0 }, [...t.all, late]);
  const r = Object.fromEntries(E.results(re).map((x) => [x.id, x.place]));
  assert.equal(r.A, 1);
  assert.deepEqual(Object.values(r).sort(), [1, 2, 3, 4, 5]);
});

// Review B2: ein undo, das (von einer alten App-Version) das Star-Ereignis trifft, bleibt wirkungslos
test('Star undo auf das Modus-Ereignis ⇒ Star bleibt an', async () => {
  const E = await load();
  const t = star(E);
  const starSeq = t.all[0].seq;
  const undo = { seq: 2, type: 'undo', round: 1, actor: null, source: null, target: null, amount: null, payload: { seq: starSeq, act: 2 } };
  const re = E.replay({ players: FIVE, startingLife: 40, firstSeat: 0, startedAt: 0 }, [...t.all, undo]);
  assert.equal(re.star, true);
});

test('Star-Siegprüfung nur bei genau 5 Spielern (fremd eingefügtes Ereignis bei 4)', async () => {
  const E = await load();
  const four = FIVE.slice(0, 4);
  const ev = (seq, type, extra) => ({ seq, type, round: 1, actor: null, source: null, target: null, amount: null, ...extra });
  const re = E.replay({ players: four, startingLife: 40, firstSeat: 0, startedAt: 0 },
    [ev(1, 'global', { payload: { key: 'star', value: true, act: 1 } }), ev(2, 'eliminate', { target: 'A', payload: { place: 4, act: 2 } })]);
  assert.equal(re.finished, false);
});
