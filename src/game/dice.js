// Würfeltisch (HANDOFF 5.4b, Spec P9): reine Simulation, ohne DOM und ohne eigenen Zufall.
// Vorlage: Main.dc.html simDice (1973–2004), throwDice (2008–2016), diceTarget (1918),
// diceResult (2071–2075), newDice (1922), holdOff (1937). Konstanten unverändert; der Tisch
// kommt als Parameter in echten Pixeln (Mittelpunkt-Grenzen des Würfels), nicht als 390er-Skala.
// Zufall immer als rand() ∈ [0, 1) von außen (Views: appRand aus src/lib/rand.js).

export const R = 30;          // halber Würfelabstand für Stöße
export const DT = 16;         // ms je Schritt (zeitbasiert, unabhängig von der Bildrate)
export const MAX_STEPS = 220; // ⇒ höchstens 3520 ms
export const MAX_GAP = 76;    // Abstand in der Startreihe

const FACES = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };

/** Endrotation [rotateX, rotateY] in Grad, damit Fläche value oben liegt (Reihenfolge rotateZ rotateX rotateY). */
export function faceRotation(value) {
  return (FACES[value] || FACES[1]).slice();
}

/**
 * Bahn vorab berechnen. starts/vels je Würfel {x, y} (px bzw. px/ms), tray = { x0, x1, y0, y1 }.
 * @returns {{ path: {t:number,x:number,y:number,d:number}[][], dur: number, dist: number[], bounces: number[] }}
 */
export function simDice(starts, vels, tray) {
  const T = tray, n = starts.length;
  const P = starts.map((p) => ({ x: p.x, y: p.y })), V = vels.map((v) => ({ x: v.x, y: v.y }));
  const path = starts.map(() => []), dist = starts.map(() => 0), bounces = [];
  let t = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    for (let i = 0; i < n; i++) {
      const ox = P[i].x, oy = P[i].y;
      P[i].x += V[i].x * DT; P[i].y += V[i].y * DT;
      const f = t < 260 ? 0.992 : 0.968; V[i].x *= f; V[i].y *= f;
      if (P[i].x < T.x0) { P[i].x = T.x0; V[i].x = Math.abs(V[i].x) * 0.7; bounces.push(t); }
      if (P[i].x > T.x1) { P[i].x = T.x1; V[i].x = -Math.abs(V[i].x) * 0.7; bounces.push(t); }
      if (P[i].y < T.y0) { P[i].y = T.y0; V[i].y = Math.abs(V[i].y) * 0.7; bounces.push(t); }
      if (P[i].y > T.y1) { P[i].y = T.y1; V[i].y = -Math.abs(V[i].y) * 0.7; bounces.push(t); }
      dist[i] += Math.hypot(P[i].x - ox, P[i].y - oy);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d = Math.hypot(dx, dy) || 0.01;
      if (d < 2 * R) {
        const nx = dx / d, ny = dy / d, ov = (2 * R - d) / 2;
        P[i].x -= nx * ov; P[i].y -= ny * ov; P[j].x += nx * ov; P[j].y += ny * ov;
        const vi = V[i].x * nx + V[i].y * ny, vj = V[j].x * nx + V[j].y * ny;
        if (vi - vj > 0) { const dv = (vi - vj) * 0.9; V[i].x -= dv * nx; V[i].y -= dv * ny; V[j].x += dv * nx; V[j].y += dv * ny; bounces.push(t); }
      }
    }
    // Abweichung zur Vorlage: das Auseinanderschieben beim Stoß kann einen Würfel an der Wand
    // über den Rand drücken ⇒ Lage nachklemmen (Geschwindigkeit bleibt, Konstanten unverändert).
    for (let i = 0; i < n; i++) {
      P[i].x = Math.max(T.x0, Math.min(T.x1, P[i].x));
      P[i].y = Math.max(T.y0, Math.min(T.y1, P[i].y));
    }
    t += DT;
    if (step % 2 === 0) for (let i = 0; i < n; i++) path[i].push({ t, x: P[i].x, y: P[i].y, d: dist[i] });
    if (t > 700 && V.every((v) => Math.hypot(v.x, v.y) < 0.02)) break;
  }
  for (let i = 0; i < n; i++) path[i].push({ t, x: P[i].x, y: P[i].y, d: dist[i] });
  return { path, dur: t, dist, bounces };
}

/**
 * Wurfgeschwindigkeit (px/ms, vor der Streuung) aus den Zeigerpunkten [{t, x, y}] der ganzen Geste.
 * Gezählt werden die Punkte der letzten ~90 ms; zu langsam (< 0,35) oder zu kurz (< 12 px bewegt)
 * ⇒ zufällig nach oben mit Betrag 1,6. Betrag geklammert auf 1,1–2,8.
 */
export function throwVelocity(samples, rand) {
  const last = samples[samples.length - 1], s0 = samples[0];
  let moved = 0;
  for (const q of samples) moved = Math.max(moved, Math.hypot(q.x - s0.x, q.y - s0.y));
  let first = s0;
  for (const q of samples) if (last.t - q.t <= 90) { first = q; break; }
  const dt = Math.max(16, last.t - first.t);
  let vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
  let sp = Math.hypot(vx, vy);
  if (sp < 0.35 || moved < 12) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.2;
    vx = Math.cos(a) * 1.6; vy = Math.sin(a) * 1.6; sp = 1.6;
  }
  const k = Math.min(2.8, Math.max(1.1, sp)) / sp;
  return { x: vx * k, y: vy * k };
}

/** Streuung je Würfel: Richtung ± 0,25 rad, Betrag × 0,85–1,15 (je Würfel zwei rand()-Züge). */
export function spreadVelocities(base, n, rand) {
  return Array.from({ length: n }, () => {
    const a = (rand() - 0.5) * 0.5, f = 0.85 + rand() * 0.3;
    return { x: (base.x * Math.cos(a) - base.y * Math.sin(a)) * f, y: (base.x * Math.sin(a) + base.y * Math.cos(a)) * f };
  });
}

/** Versatz der gehaltenen Würfel um den Finger (k-ter von m). */
export function holdOffset(k, m) {
  if (m <= 1) return { x: 0, y: 0 };
  const a = (k / m) * Math.PI * 2, r = 22 + m * 5;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** Startreihe: n Würfel nebeneinander knapp über dem unteren Tischrand, Abstand ≤ 76 px. */
export function startRow(n, tray) {
  const T = tray;
  const gap = Math.min(MAX_GAP, (T.x1 - T.x0) / Math.max(1, n - 1));
  const cx = (T.x0 + T.x1) / 2, y = Math.max(T.y0, T.y1 - 40);
  return Array.from({ length: n }, (_, i) => ({ x: cx + (i - (n - 1) / 2) * gap, y }));
}

/** Klemmt einen Punkt in den Tisch. */
export function clampToTray(p, tray) {
  return { x: Math.max(tray.x0, Math.min(tray.x1, p.x)), y: Math.max(tray.y0, Math.min(tray.y1, p.y)) };
}

/**
 * Ergebnis des Startwurfs. values je Sitz (letzter Wert), activeSeats = die gerade Würfelnden.
 * @returns {{ winnerSeat: number } | { tie: number[] }}
 */
export function startResult(values, activeSeats) {
  const mx = Math.max(...activeSeats.map((s) => values[s]));
  const top = activeSeats.filter((s) => values[s] === mx);
  return top.length > 1 ? { tie: top } : { winnerSeat: top[0] };
}
