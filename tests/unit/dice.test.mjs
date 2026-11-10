// Spec P9: Würfeltisch (reine Simulation src/game/dice.js). Jeder Fall lädt das Modul selbst per
// import() (Gegenprobe: am Stand ohne src/game/dice.js rot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const load = () => import('../../src/game/dice.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Stub: liefert die angegebenen Werte der Reihe nach, danach wiederholt den letzten. */
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
// Tisch 300 × 400 (Mittelpunkt-Grenzen des Würfels, Pixel)
const TRAY = { x0: 50, x1: 350, y0: 100, y1: 500 };
const R = 30;
const EPS = 1e-9;

function fourDice(angle) {
  const cx = (TRAY.x0 + TRAY.x1) / 2;
  const starts = [0, 1, 2, 3].map((i) => ({ x: cx + (i - 1.5) * 70, y: TRAY.y1 - 40 }));
  const vels = [0, 1, 2, 3].map((i) => {
    const a = angle + i * 0.4;
    return { x: Math.cos(a) * 2.8, y: Math.sin(a) * 2.8 };
  });
  return { starts, vels };
}

test('D1 bleibt im Tisch (4 Würfel, Betrag 2,8, 72 Richtungen)', async () => {
  const D = await load();
  for (let k = 0; k < 72; k++) {
    const { starts, vels } = fourDice((k / 72) * Math.PI * 2);
    const sim = D.simDice(starts, vels, TRAY);
    for (const p of sim.path) for (const q of p) {
      assert.ok(q.x >= TRAY.x0 - EPS && q.x <= TRAY.x1 + EPS, `x ${q.x} außerhalb (Richtung ${k})`);
      assert.ok(q.y >= TRAY.y0 - EPS && q.y <= TRAY.y1 + EPS, `y ${q.y} außerhalb (Richtung ${k})`);
    }
  }
});

test('D2 endet: dur ≤ 220 × 16 = 3520 ms', async () => {
  const D = await load();
  for (let k = 0; k < 72; k++) {
    const { starts, vels } = fourDice((k / 72) * Math.PI * 2);
    const sim = D.simDice(starts, vels, TRAY);
    assert.ok(sim.dur <= 3520, `dur ${sim.dur}`);
    assert.ok(sim.dur > 0);
    for (const p of sim.path) assert.equal(p[p.length - 1].t, sim.dur, 'letzter Bahnpunkt bei dur');
  }
});

test('D3 trennt Würfel mit gleicher Startposition', async () => {
  const D = await load();
  const s = { x: 200, y: 300 };
  // gleiche Position, verschiedene Geschwindigkeiten (bei gleicher Geschwindigkeit gibt es keine Normale)
  const sim = D.simDice([s, s], [{ x: 0.3, y: -0.2 }, { x: -0.2, y: 0.4 }], TRAY);
  const a = sim.path[0].at(-1), b = sim.path[1].at(-1);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * R - 0.5, `Abstand ${Math.hypot(a.x - b.x, a.y - b.y)}`);
});

test('D4 deterministisch: gleiche Eingabe ⇒ tief gleiche Bahn', async () => {
  const D = await load();
  const { starts, vels } = fourDice(1.1);
  const a = D.simDice(starts, vels, TRAY);
  const b = D.simDice(structuredClone(starts), structuredClone(vels), { ...TRAY });
  assert.deepEqual(a, b);
  // Eingaben bleiben unverändert
  assert.deepEqual(starts, fourDice(1.1).starts);
  assert.deepEqual(vels, fourDice(1.1).vels);
});

test('D5 Ruhe ⇒ kurz: Geschwindigkeit 0 ⇒ dur 704 ms', async () => {
  const D = await load();
  const sim = D.simDice([{ x: 120, y: 300 }, { x: 260, y: 300 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }], TRAY);
  assert.equal(sim.dur, 704);
});

test('D6 Flächen: faceRotation(1..6)', async () => {
  const D = await load();
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((v) => D.faceRotation(v)),
    [[0, 0], [0, -90], [-90, 0], [90, 0], [0, 90], [0, 180]]);
});

test('D7 Wurf zu schwach ⇒ nach oben, Betrag 1,6 vor Streuung', async () => {
  const D = await load();
  const samples = [{ t: 0, x: 100, y: 300 }, { t: 45, x: 103, y: 298 }, { t: 90, x: 105, y: 300 }];
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const v = D.throwVelocity(samples, seq(r));
    assert.ok(v.y < 0, `vy ${v.y} bei rand ${r}`);
    assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1.6) < 1e-9, `Betrag ${Math.hypot(v.x, v.y)}`);
  }
  // rand 0,5 ⇒ genau senkrecht nach oben
  const up = D.throwVelocity(samples, seq(0.5));
  assert.ok(Math.abs(up.x) < 1e-9 && Math.abs(up.y + 1.6) < 1e-9);
});

test('D8 Betrag geklammert: Betrag 9 ⇒ 2,8 vor Streuung, Richtung erhalten', async () => {
  const D = await load();
  // 90 ms, 810 px nach rechts ⇒ 9 px/ms
  const samples = [{ t: 0, x: 0, y: 300 }, { t: 45, x: 405, y: 300 }, { t: 90, x: 810, y: 300 }];
  const rand = () => { throw new Error('rand darf bei starkem Wurf nicht gezogen werden'); };
  const v = D.throwVelocity(samples, rand);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 2.8) < 1e-9, `Betrag ${Math.hypot(v.x, v.y)}`);
  assert.ok(v.x > 0 && Math.abs(v.y) < 1e-9);
  // nur Punkte der letzten ~90 ms zählen: frühe langsame Punkte ändern nichts
  const v2 = D.throwVelocity([{ t: -500, x: 0, y: 300 }, ...samples], rand);
  assert.deepEqual(v2, v);
});

test('Streuung: ± 0,25 rad und × 0,85–1,15 je Würfel', async () => {
  const D = await load();
  const base = { x: 0, y: -2 };
  const lo = D.spreadVelocities(base, 1, seq(0, 0))[0];
  const hi = D.spreadVelocities(base, 1, seq(0.999999, 0.999999))[0];
  const mid = D.spreadVelocities(base, 1, seq(0.5, 0.5))[0];
  assert.ok(Math.abs(Math.hypot(lo.x, lo.y) - 2 * 0.85) < 1e-9);
  assert.ok(Math.abs(Math.hypot(hi.x, hi.y) - 2 * 1.15) < 1e-5);
  assert.ok(Math.abs(mid.x) < 1e-9 && Math.abs(mid.y + 2) < 1e-9);
  const ang = (v) => Math.atan2(v.y, v.x) - Math.atan2(base.y, base.x);
  assert.ok(Math.abs(ang(lo) + 0.25) < 1e-9 && Math.abs(ang(hi) - 0.25) < 1e-5);
  assert.equal(D.spreadVelocities(base, 4, seq(0.5)).length, 4);
});

test('D9 Sieger: [3,6,2,5] alle aktiv ⇒ winnerSeat 1', async () => {
  const D = await load();
  assert.deepEqual(D.startResult([3, 6, 2, 5], [0, 1, 2, 3]), { winnerSeat: 1 });
});

test('D10 Gleichstand: [6,6,2,5] ⇒ tie [0,1]', async () => {
  const D = await load();
  assert.deepEqual(D.startResult([6, 6, 2, 5], [0, 1, 2, 3]), { tie: [0, 1] });
});

test('D11 Nachwurf nur Gleichstehende: [4,2] für 0,1 ⇒ winnerSeat 0', async () => {
  const D = await load();
  // Sitze 2 und 3 behalten ihre alten Werte (2 und 5) und zählen nicht
  assert.deepEqual(D.startResult([4, 2, 2, 5], [0, 1]), { winnerSeat: 0 });
  assert.deepEqual(D.startResult([4, 4, 6, 6], [0, 1]), { tie: [0, 1] });
});

test('D12 ohne Math.random in src/game/dice.js', async () => {
  await load(); // existiert
  const src = fs.readFileSync(path.join(ROOT, 'src', 'game', 'dice.js'), 'utf8');
  assert.ok(!/Math\s*\.\s*random/.test(src));
});

test('Startreihe: Abstand ≤ 76 px, 2 und 6 Würfel passen in den Tisch', async () => {
  const D = await load();
  for (const n of [2, 3, 4, 5, 6]) {
    const row = D.startRow(n, TRAY);
    assert.equal(row.length, n);
    for (const p of row) assert.ok(p.x >= TRAY.x0 && p.x <= TRAY.x1 && p.y >= TRAY.y0 && p.y <= TRAY.y1);
    for (let i = 1; i < n; i++) assert.ok(row[i].x - row[i - 1].x <= 76 + 1e-9);
  }
  const narrow = { x0: 56, x1: 290, y0: 140, y1: 560 }; // 6 Würfel auf schmalem Tisch
  const row6 = D.startRow(6, narrow);
  assert.ok(row6[0].x >= narrow.x0 && row6[5].x <= narrow.x1);
});
