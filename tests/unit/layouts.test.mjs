// Spec P3: Sitzlayouts. Die Golden-Tabelle ist von Hand aus
// mockup/design-canvas-quellen/Main.dc.html:1706–1737 abgeschrieben (nicht aus src/game erzeugt).
// Jeder Slot als [c, r, rot, cs, rs], alle fünf Werte ausgeschrieben. Die 'unten'-Zeilen sind
// aus der Schleife (Main.dc.html:1709–1713) von Hand ausgerechnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/game/layouts.js');

const G2 = { cols: 1, rows: 2, slots: [[1, 1, 180, 1, 1], [1, 2, 0, 1, 1]] };
const GOLDEN = {
  unten: {
    2: { cols: 1, rows: 2, slots: [[1, 1, 0, 1, 1], [1, 2, 0, 1, 1]] },
    3: { cols: 2, rows: 2, slots: [[1, 1, 0, 1, 1], [2, 1, 0, 1, 1], [1, 2, 0, 2, 1]] },
    4: { cols: 2, rows: 2, slots: [[1, 1, 0, 1, 1], [2, 1, 0, 1, 1], [1, 2, 0, 1, 1], [2, 2, 0, 1, 1]] },
    5: { cols: 2, rows: 3, slots: [[1, 1, 0, 1, 1], [2, 1, 0, 1, 1], [1, 2, 0, 1, 1], [2, 2, 0, 1, 1], [1, 3, 0, 2, 1]] },
    6: { cols: 2, rows: 3, slots: [[1, 1, 0, 1, 1], [2, 1, 0, 1, 1], [1, 2, 0, 1, 1], [2, 2, 0, 1, 1], [1, 3, 0, 1, 1], [2, 3, 0, 1, 1]] },
  },
  gegenueber: {
    2: G2,
    3: { cols: 2, rows: 2, slots: [[1, 1, 180, 1, 1], [2, 1, 180, 1, 1], [1, 2, 0, 2, 1]] },
    4: { cols: 2, rows: 2, slots: [[1, 1, 180, 1, 1], [2, 1, 180, 1, 1], [2, 2, 0, 1, 1], [1, 2, 0, 1, 1]] },
    5: { cols: 6, rows: 2, slots: [[1, 1, 180, 2, 1], [3, 1, 180, 2, 1], [5, 1, 180, 2, 1], [4, 2, 0, 3, 1], [1, 2, 0, 3, 1]] },
    6: { cols: 3, rows: 2, slots: [[1, 1, 180, 1, 1], [2, 1, 180, 1, 1], [3, 1, 180, 1, 1], [3, 2, 0, 1, 1], [2, 2, 0, 1, 1], [1, 2, 0, 1, 1]] },
  },
  rundum: {
    2: G2,
    3: { cols: 2, rows: 2, slots: [[1, 1, 180, 2, 1], [2, 2, -90, 1, 1], [1, 2, 90, 1, 1]] },
    4: { cols: 2, rows: 3, slots: [[1, 1, 180, 2, 1], [2, 2, -90, 1, 1], [1, 3, 0, 2, 1], [1, 2, 90, 1, 1]] },
    5: { cols: 2, rows: 4, slots: [[1, 1, 180, 2, 1], [2, 2, -90, 1, 1], [2, 3, -90, 1, 1], [1, 4, 0, 2, 1], [1, 2, 90, 1, 2]] },
    6: { cols: 2, rows: 4, slots: [[1, 1, 180, 2, 1], [2, 2, -90, 1, 1], [2, 3, -90, 1, 1], [1, 4, 0, 2, 1], [1, 3, 90, 1, 1], [1, 2, 90, 1, 1]] },
  },
  seiten: {
    2: G2,
    3: { cols: 2, rows: 2, slots: [[1, 1, 90, 1, 1], [2, 1, -90, 1, 1], [1, 2, 0, 2, 1]] },
    4: { cols: 2, rows: 2, slots: [[1, 1, 90, 1, 1], [2, 1, -90, 1, 1], [2, 2, -90, 1, 1], [1, 2, 90, 1, 1]] },
    5: { cols: 2, rows: 3, slots: [[1, 1, 90, 1, 1], [2, 1, -90, 1, 1], [2, 2, -90, 1, 1], [1, 3, 0, 2, 1], [1, 2, 90, 1, 1]] },
    6: { cols: 2, rows: 3, slots: [[1, 1, 90, 1, 1], [2, 1, -90, 1, 1], [2, 2, -90, 1, 1], [2, 3, -90, 1, 1], [1, 3, 90, 1, 1], [1, 2, 90, 1, 1]] },
  },
};
const expand = (g) => ({ cols: g.cols, rows: g.rows, slots: g.slots.map(([c, r, rot, cs, rs]) => ({ c, r, rot, cs, rs })) });

test('L1 layoutFor: 2 Spieler bei seiten/rundum ⇒ gegenueber', async () => {
  const L = await load();
  for (const name of ['seiten', 'rundum']) {
    const r = L.layoutFor(2, name);
    assert.equal(r.layout, 'gegenueber');
    assert.deepEqual({ cols: r.cols, rows: r.rows, slots: r.slots }, expand(GOLDEN.gegenueber[2]));
  }
});

test('L2 Golden: slotsFor wertgleich mit dem Prototyp (n 2..6 × 4 Layouts)', async () => {
  const L = await load();
  let combos = 0;
  for (const name of ['seiten', 'rundum', 'gegenueber', 'unten']) {
    for (let n = 2; n <= 6; n++) {
      const g = GOLDEN[name][n];
      assert.ok(g, `Golden fehlt für ${name}/${n}`);
      assert.equal(g.slots.length, n, `Golden ${name}/${n} hat ${g.slots.length} Slots`);
      assert.deepEqual(L.slotsFor(n, name), expand(g), `${name}/${n}`);
      combos++;
    }
  }
  assert.equal(combos, 20);
});

test('layoutFor: Rückfall auf unten, wenn slotsFor nichts liefert', async () => {
  const L = await load();
  const r = L.layoutFor(7, 'gegenueber');
  assert.equal(r.layout, 'unten');
  assert.equal(r.cols, 2); assert.equal(r.rows, 4); assert.equal(r.slots.length, 7);
  const one = L.layoutFor(1, 'seiten');
  assert.equal(one.layout, 'unten');
  assert.deepEqual(one.slots, [{ c: 1, r: 1, rot: 0, cs: 1, rs: 1 }]);
  const four = L.layoutFor(4, 'rundum');
  assert.equal(four.layout, 'rundum');
  assert.deepEqual({ cols: four.cols, rows: four.rows, slots: four.slots }, expand(GOLDEN.rundum[4]));
});
