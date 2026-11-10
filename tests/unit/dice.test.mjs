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

// ---------------------------------------------------------------- Review B1: Endlage (Würfel + Namensschilder)
const HALF = 32; // halbe Würfelkante (src/views/dice.js)
/** Tisch wie dice.css bei Fenster w × h: Filz 12 px Rand, oben 92, unten 196; Würfel-Einzug 44/46, Schild-Einzug 12. */
function table(w, h) {
  const felt = { x0: 12, x1: w - 12, y0: 92, y1: h - 196 };
  return {
    tray: { x0: felt.x0 + 44, x1: felt.x1 - 44, y0: felt.y0 + 46, y1: felt.y1 - 46 },
    box: { x0: felt.x0 + 12, x1: felt.x1 - 12, y0: felt.y0 + 12, y1: felt.y1 - 12 },
  };
}
/** Feste Schildmaße: die größte Breite, die src/views/dice.js zulässt (--dt-tagw), Höhe 21 px. */
const tagSizes = (n, box) => Array.from({ length: n }, () => ({ w: Math.max(52, Math.min(140, Math.floor((box.x1 - box.x0) / (n <= 2 ? n : n <= 4 ? 2 : 3)) - 4)), h: 21 }));
const lcg = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Unabhängige Prüfung einer Endlage (eigene Geometrie, nicht layoutFree). Liefert den ersten Verstoß oder ''. */
function issue(D, P, sizes, tray, box) {
  const tags = D.placeTags(P, sizes, box, HALF);
  for (let i = 0; i < P.length; i++) {
    const a = tags[i];
    if (P[i].x < tray.x0 || P[i].x > tray.x1 || P[i].y < tray.y0 || P[i].y > tray.y1) return `Würfel ${i} außerhalb des Tischs`;
    if (a.x < box.x0 || a.x + a.w > box.x1 || a.y < box.y0 || a.y + a.h > box.y1) return `Schild ${i} ragt aus dem Tisch`;
    if (a.y !== P[i].y - HALF - 30) return `Schild ${i} sitzt nicht 30 px über der Würfelkante`;
    for (let j = i + 1; j < P.length; j++) {
      if (Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) < 2 * R) return `Würfel ${i}/${j} übereinander`;
      if (overlap(a, tags[j])) return `Schilder ${i}/${j} überlappen`;
      const bi = { x: P[i].x - HALF, y: P[i].y - HALF, w: 64, h: 64 }, bj = { x: P[j].x - HALF, y: P[j].y - HALF, w: 64, h: 64 };
      if (overlap(a, bj) || overlap(tags[j], bi)) return `Schild liegt auf fremdem Würfel (${i}/${j})`;
    }
  }
  return '';
}
/** Ein Wurf wie in der View: Geste ⇒ Geschwindigkeit ⇒ Bahn (Liegende als Hindernisse) ⇒ Entzerrung ⇒ Bahn mit Endlage. */
function throwLike(D, rand, pos, act, tray, box, sizes) {
  const sx = tray.x0 + rand() * (tray.x1 - tray.x0), sy = tray.y0 + rand() * (tray.y1 - tray.y0);
  const ang = -Math.PI / 2 + (rand() - 0.5) * 3, sp = rand() * 4;
  const samples = [{ t: 0, x: sx, y: sy }, { t: 80, x: sx + Math.cos(ang) * sp * 80, y: sy + Math.sin(ang) * sp * 80 }];
  const vels = D.spreadVelocities(D.throwVelocity(samples, rand), act.length, rand);
  const rel = D.clampToTray(samples[1], tray);
  const starts = act.map((_, k) => { const o = D.holdOffset(k, act.length); return D.clampToTray({ x: rel.x + o.x, y: rel.y + o.y }, tray); });
  const sim = D.simDice(starts, vels, tray, pos.filter((_, i) => !act.includes(i)));
  const points = pos.map((p) => ({ x: p.x, y: p.y }));
  act.forEach((i, k) => { const e = sim.path[k].at(-1); points[i] = { x: e.x, y: e.y }; });
  const end = D.settleLayout({ points, movable: act, sizes, tray, box, half: HALF, prev: pos });
  return { end, sim, path: D.blendPaths(sim.path, act.map((i) => end[i]), sim.dur, tray) };
}

test('B1 Endlage: 2000 gesäte Würfe je Spielerzahl und Tischbreite (375, 390), Erstwurf + Nachwurf', async () => {
  const D = await load();
  for (const [w, h] of [[375, 667], [390, 844]]) for (const n of [2, 3, 4, 5, 6]) {
    const { tray, box } = table(w, h), sizes = tagSizes(n, box), rand = lcg(1000 * w + n);
    const all = Array.from({ length: n }, (_, i) => i);
    for (let g = 0; g < 2000; g++) {
      const at = `${w} px, ${n} Spieler, Wurf ${g}`;
      const first = throwLike(D, rand, D.startRow(n, tray), all, tray, box, sizes);
      const bad1 = issue(D, first.end, sizes, tray, box);
      if (bad1) assert.fail(`Erstwurf ${at}: ${bad1}`);
      // Gleichstand: 2..n Würfel werfen nochmal, die übrigen liegen und dürfen sich nicht bewegen
      const m = 2 + Math.floor(rand() * (n - 1));
      const act = all.map((i) => [rand(), i]).sort((a, b) => a[0] - b[0]).slice(0, m).map((x) => x[1]).sort((a, b) => a - b);
      const re = throwLike(D, rand, first.end, act, tray, box, sizes);
      const bad2 = issue(D, re.end, sizes, tray, box);
      if (bad2) assert.fail(`Nachwurf ${at}: ${bad2}`);
      for (const i of all) if (!act.includes(i) && (re.end[i].x !== first.end[i].x || re.end[i].y !== first.end[i].y)) assert.fail(`liegender Würfel ${i} bewegt (${at})`);
      // Bahn endet ohne Sprung in der Endlage und bleibt im Tisch; Zeitpunkte unverändert
      for (const [thr, ids] of [[first, all], [re, act]]) ids.forEach((i, k) => {
        const p = thr.path[k], e = p[p.length - 1];
        if (e.x !== thr.end[i].x || e.y !== thr.end[i].y) assert.fail(`letzter Bahnpunkt ≠ Endlage (${at})`);
        if (e.t !== thr.sim.dur || p.length !== thr.sim.path[k].length) assert.fail(`Zeitpunkte der Bahn verändert (${at})`);
        for (let j = 0; j < p.length; j++) {
          const q = p[j];
          if (q.x < tray.x0 - EPS || q.x > tray.x1 + EPS || q.y < tray.y0 - EPS || q.y > tray.y1 + EPS) assert.fail(`Bahnpunkt außerhalb (${at})`);
          if (j) { // die Entzerrung fügt je Bahnschritt (32 ms) höchstens 30 px Weg hinzu ⇒ kein Sprung
            const s0 = thr.sim.path[k][j - 1], s1 = thr.sim.path[k][j];
            if (Math.hypot(q.x - p[j - 1].x, q.y - p[j - 1].y) > Math.hypot(s1.x - s0.x, s1.y - s0.y) + 30) assert.fail(`Sprung in der Bahn (${at})`);
          }
        }
      });
    }
  }
});

test('B1 reduzierte Bewegung: Reihen-Lage ist frei (2–6 Spieler, 375 × 667, 375 × 812, 390 × 844), Nachwurf bleibt liegen', async () => {
  const D = await load();
  for (const [w, h] of [[375, 667], [375, 812], [390, 844]]) for (const n of [2, 3, 4, 5, 6]) {
    const { tray, box } = table(w, h), sizes = tagSizes(n, box);
    const grid = D.gridLayout(n, sizes, tray, box, HALF);
    assert.equal(grid.length, n);
    assert.equal(issue(D, grid, sizes, tray, box), '', `${w} × ${h}, ${n} Spieler`);
    assert.ok(D.layoutFree(grid, sizes, tray, box, HALF));
    // Nachwurf ohne Flug: die Würfel liegen schon frei ⇒ die Entzerrung lässt sie, wo sie sind
    assert.deepEqual(D.settleLayout({ points: grid, movable: [0, n - 1], sizes, tray, box, half: HALF, prev: grid }), grid);
    // Sitzreihenfolge: zeilenweise von links nach rechts
    for (let i = 1; i < n; i++) assert.ok(grid[i].y > grid[i - 1].y || (grid[i].y === grid[i - 1].y && grid[i].x > grid[i - 1].x));
  }
  // die Startreihe selbst wäre bei 6 Spielern auf 375 px keine freie Endlage (Befund B1)
  const { tray, box } = table(375, 667);
  assert.equal(D.layoutFree(D.startRow(6, tray), tagSizes(6, box), tray, box, HALF), false);
});

test('B1 placeTags: mittig über dem Würfel, am Rand in den Tisch geschoben', async () => {
  const D = await load();
  const { tray, box } = table(375, 667);
  const sizes = [{ w: 100, h: 21 }, { w: 100, h: 21 }, { w: 60, h: 21 }];
  const [mid, left, right] = D.placeTags([{ x: 190, y: 300 }, { x: tray.x0, y: 300 }, { x: tray.x1, y: 300 }], sizes, box, HALF);
  assert.deepEqual(mid, { x: 140, y: 238, w: 100, h: 21, dx: 0 });
  assert.equal(left.x, box.x0);
  assert.equal(left.dx, box.x0 + 50 - tray.x0); // 18 px nach rechts geschoben
  assert.equal(right.x, tray.x1 - 30); // schmales Schild passt mittig
  assert.equal(right.dx, 0);
  // oberste erlaubte Lage: Schild-Oberkante genau am Tischrand
  const A = D.restArea(tray, box, HALF);
  assert.equal(D.placeTags([{ x: 190, y: A.y0 }], [sizes[0]], box, HALF)[0].y, box.y0);
  assert.deepEqual({ x0: A.x0, x1: A.x1, y1: A.y1 }, { x0: tray.x0, x1: tray.x1, y1: tray.y1 });
});

test('B1 liegende Würfel sind Hindernisse: ohne fixed unveränderte Bahn, Nachwurf prallt am liegenden ab', async () => {
  const D = await load();
  const { starts, vels } = fourDice(0.7);
  assert.deepEqual(D.simDice(starts, vels, TRAY, []), D.simDice(starts, vels, TRAY));
  // Würfel fliegt gerade auf einen liegenden zu: prallt ab, der Liegende hat keine Bahn
  const lying = { x: 200, y: 200 };
  const sim = D.simDice([{ x: 200, y: 460 }], [{ x: 0, y: -2 }], TRAY, [lying]);
  assert.equal(sim.path.length, 1);
  for (const q of sim.path[0]) assert.ok(q.y > lying.y + R, `Bahnpunkt tief im liegenden Würfel: y ${q.y}`);
  const e = sim.path[0].at(-1);
  assert.ok(Math.hypot(e.x - lying.x, e.y - lying.y) >= 2 * R);
  assert.ok(e.y > lying.y + 2 * R + 20, `zurückgeprallt (y ${e.y})`);
  assert.ok(sim.bounces.length >= 1);
  // ohne Hindernis flöge er über die Stelle hinweg
  assert.ok(D.simDice([{ x: 200, y: 460 }], [{ x: 0, y: -2 }], TRAY).path[0].some((q) => q.y < lying.y));
});

test('B1 Entzerrung ohne Ausweg: Liegende bleiben, Geworfene finden einen freien Platz; alle auf einem Punkt ⇒ frei', async () => {
  const D = await load();
  const { tray, box } = table(375, 667), sizes = tagSizes(6, box);
  const grid = D.gridLayout(6, sizes, tray, box, HALF);
  // 5 liegen in der Reihen-Lage, der sechste will mitten auf den ersten
  const want = grid.map((p) => ({ ...p })); want[5] = { x: grid[0].x + 10, y: grid[0].y + 5 };
  const out = D.settleLayout({ points: want, movable: [5], sizes, tray, box, half: HALF, prev: grid });
  assert.equal(issue(D, out, sizes, tray, box), '');
  assert.deepEqual(out.slice(0, 5), grid.slice(0, 5));
  // alle sechs auf einem Punkt ⇒ trotzdem frei
  const heap = Array.from({ length: 6 }, () => ({ x: 190, y: 300 }));
  assert.equal(issue(D, D.settleLayout({ points: heap, movable: [0, 1, 2, 3, 4, 5], sizes, tray, box, half: HALF }), sizes, tray, box), '');
  // blendPaths: letzter Punkt = Ziel, Anfang der Bahn (bis 30 % der Zeit) unverändert
  const sim = D.simDice([{ x: 190, y: 400 }], [{ x: 0.4, y: -1.8 }], tray);
  const [bl] = D.blendPaths(sim.path, [{ x: 100, y: 250 }], sim.dur, tray);
  assert.deepEqual({ x: bl.at(-1).x, y: bl.at(-1).y, t: bl.at(-1).t }, { x: 100, y: 250, t: sim.dur });
  sim.path[0].forEach((q, j) => { if (q.t <= sim.dur * 0.3) assert.deepEqual(bl[j], q); });
});
