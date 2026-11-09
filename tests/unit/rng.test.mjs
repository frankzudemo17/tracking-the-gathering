// Spec P3: Zufall. Jeder Fall lädt das Modul selbst per import() (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/game/rng.js');
const TWO32 = 2 ** 32;
/** Stub: liefert die angegebenen Werte der Reihe nach, danach wiederholt den letzten. */
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
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

test('R1 randInt verwirft Werte oberhalb der Grenze (kein Modulo-Bias)', async () => {
  const R = await load();
  let calls = 0;
  const base = seq(0xFFFFFFFF / TWO32, 0);
  const rand = () => { calls++; return base(); };
  assert.equal(R.randInt(6, rand), 0);
  assert.equal(calls, 2);
  // ohne Verwerfen wäre es 0xFFFFFFFF % 6 = 3
  assert.equal(0xFFFFFFFF % 6, 3);
});

test('R2 randInt Bereich und Gleichverteilung mit echter Quelle (10 000 Würfe, n=6)', async () => {
  const R = await load();
  const rand = R.randomSource();
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 10000; i++) {
    const v = R.randInt(6, rand);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 5, `außerhalb: ${v}`);
    counts[v]++;
  }
  for (const c of counts) assert.ok(c >= 1480 && c <= 1853, `Häufigkeit ${c} (alle: ${counts.join(', ')})`);
});

test('randomSource liefert Werte in [0,1)', async () => {
  const R = await load();
  const rand = R.randomSource();
  for (let i = 0; i < 1000; i++) { const x = rand(); assert.ok(x >= 0 && x < 1); }
});

test('R3 roll w6x2 liefert zwei Werte 1..6', async () => {
  const R = await load();
  const r = R.roll('w6x2', [], seq(0, 5 / TWO32));
  assert.equal(r.kind, 'w6x2');
  assert.deepEqual(r.values, [1, 6]);
  const rand = prng(3);
  for (let i = 0; i < 200; i++) {
    const x = R.roll('w6x2', [], rand);
    assert.equal(x.values.length, 2);
    assert.ok(x.values.every((v) => v >= 1 && v <= 6));
  }
});

test('R4 roll player trifft nie einen Ausgeschiedenen', async () => {
  const R = await load();
  const players = [{ seat: 0, out: false }, { seat: 1, out: false }, { seat: 2, out: true }, { seat: 3, out: false }];
  const rand = prng(9);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const r = R.roll('player', players, rand);
    assert.notEqual(r.winnerSeat, 2);
    assert.deepEqual(r.values, [r.winnerSeat]);
    seen.add(r.winnerSeat);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 3]);
});

test('roll w6, w20, coin: Wertebereiche', async () => {
  const R = await load();
  const rand = prng(11);
  const w20 = new Set(), coin = new Set(), w6 = new Set();
  for (let i = 0; i < 2000; i++) {
    w6.add(R.roll('w6', [], rand).values[0]);
    w20.add(R.roll('w20', [], rand).values[0]);
    coin.add(R.roll('coin', [], rand).values[0]);
  }
  assert.deepEqual([...w6].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...w20].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual([...coin].sort(), [0, 1]);
  assert.throws(() => R.roll('w7', [], rand));
});
