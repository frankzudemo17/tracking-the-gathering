// P17 Gewinner wählen: beim „Spiel beenden“ kann ein lebender Spieler zum Sieger erklärt werden
// (Kombo, Alternativsieg, Aufgabe …), die übrigen Lebenden folgen nach Leben, dann Sitz.
// Sollwerte von Hand, nicht aus der Engine abgeleitet.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/game/engine.js');
const FOUR = ['A', 'B', 'C', 'D'].map((id, seat) => ({ id, name: id, seat }));

function table(E, players = FOUR) {
  let s = E.createGame({ players, startingLife: 40, firstSeat: 0, startedAt: 0 });
  const run = (a) => { const r = E.act(s, a); s = r.state; return r; };
  return { get s() { return s; }, run };
}
const places = (r) => Object.fromEntries(r.map((x) => [x.id, x.place]));

test('Sieger gewählt: wird Platz 1, Rest nach Leben ab Platz 2', async () => {
  const E = await load(); const t = table(E);
  t.run({ type: 'life', target: 'B', d: -5 });  // A 40, B 35, C 40, D 40
  t.run({ type: 'life', target: 'D', d: -30 }); // D 10
  assert.deepEqual(places(E.results(t.s, 'D')), { D: 1, A: 2, C: 3, B: 4 });
  // Gegenprobe: ohne Wahl wie bisher nach Leben, Gleichstand nach Sitz
  assert.deepEqual(places(E.results(t.s)), { A: 1, C: 2, B: 3, D: 4 });
  assert.deepEqual(places(E.results(t.s, null)), { A: 1, C: 2, B: 3, D: 4 });
});

test('Sieger gewählt mit Ausgeschiedenen: deren Plätze bleiben', async () => {
  const E = await load(); const t = table(E);
  t.run({ type: 'eliminate', target: 'B', by: 'A' }); // B Platz 4
  t.run({ type: 'life', target: 'A', d: -1 });         // A 39, C 40, D 40
  assert.deepEqual(places(E.results(t.s, 'A')), { A: 1, C: 2, D: 3, B: 4 });
});

test('Wahl ungültig ⇒ ignoriert: Ausgeschiedener, Unbekannter, Spiel schon entschieden', async () => {
  const E = await load(); const t = table(E);
  t.run({ type: 'eliminate', target: 'B', by: 'A' });
  t.run({ type: 'life', target: 'C', d: -1 });
  const plain = places(E.results(t.s));
  assert.deepEqual(places(E.results(t.s, 'B')), plain, 'ausgeschiedener Spieler');
  assert.deepEqual(places(E.results(t.s, 'X')), plain, 'unbekannte ID');
  t.run({ type: 'eliminate', target: 'C', by: 'A' });
  t.run({ type: 'eliminate', target: 'D', by: 'A' });
  assert.equal(t.s.finished, true);
  assert.deepEqual(places(E.results(t.s, 'A')), { A: 1, D: 2, C: 3, B: 4 });
});

test('Gewinnerwahl ändert nur Plätze, nicht Leben oder K.O.-Daten', async () => {
  const E = await load(); const t = table(E);
  t.run({ type: 'eliminate', target: 'C', by: 'D' });
  t.run({ type: 'life', target: 'A', d: -7 });
  const a = E.results(t.s); const b = E.results(t.s, 'A');
  const strip = (r) => r.map(({ place, ...rest }) => rest);
  assert.deepEqual(strip(b), strip(a));
  assert.deepEqual([...new Set(b.map((x) => x.place))].sort(), [1, 2, 3, 4], 'Plätze eindeutig 1..4');
});

test('Star entschieden: Wahl ändert nichts, auch nicht an den Plätzen dahinter', async () => {
  const E = await load();
  const t = table(E, ['A', 'B', 'C', 'D', 'E'].map((id, seat) => ({ id, name: id, seat })));
  t.run({ type: 'global', key: 'star', value: true });
  t.run({ type: 'life', target: 'B', d: -5 });
  t.run({ type: 'eliminate', target: 'C' });
  t.run({ type: 'eliminate', target: 'D' }); // A (Feinde C, D) gewinnt
  assert.equal(t.s.finished, true);
  const plain = places(E.results(t.s));
  assert.equal(plain.A, 1);
  assert.deepEqual(places(E.results(t.s, 'B')), plain);
});

test('Siegbedingungen: Engine-Liste gleich der Ergebnis- und Historienliste', async () => {
  const E = await load();
  const R = await import('../../src/views/result-ui.js');
  const H = await import('../../src/views/history-ui.js');
  assert.deepEqual(E.WINCONS, R.WINCONS);
  assert.deepEqual(E.WINCONS, H.WINCONS);
});
