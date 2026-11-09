// Spec P3: K.O.-Auswahl. Jeder Fall lädt das Modul selbst per import() (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/game/ko.js');
const TWO32 = 2 ** 32;
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

test('K1 koPick: Variante B zeigt nie Spruch 0', async () => {
  const K = await load();
  // randInt(3) = u mod 3: u = 1 ⇒ Index 1 = 'B'; danach Spruch u = 0; Ersatzwurf u = 0 ⇒ 1
  const r = K.koPick(seq(1 / TWO32, 0, 0));
  assert.equal(r.variant, 'B');
  assert.ok(r.quote >= 1 && r.quote <= 7, `quote ${r.quote}`);
  assert.equal(r.quote, 1);
});

test('koPick: A und C dürfen Spruch 0 zeigen, Bereich 0..7', async () => {
  const K = await load();
  assert.deepEqual(K.koPick(seq(0, 0)), { variant: 'A', quote: 0 });
  assert.deepEqual(K.koPick(seq(2 / TWO32, 0)), { variant: 'C', quote: 0 });
  assert.deepEqual(K.koPick(seq(1 / TWO32, 7 / TWO32)), { variant: 'B', quote: 7 });
});
