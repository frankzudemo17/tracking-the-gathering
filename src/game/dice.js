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
 * fixed = liegende Würfel [{x, y}] (Nachwurf bei Gleichstand): feste Hindernisse, bewegen sich nie.
 * @returns {{ path: {t:number,x:number,y:number,d:number}[][], dur: number, dist: number[], bounces: number[] }}
 */
export function simDice(starts, vels, tray, fixed = []) {
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
    // Abweichung zur Vorlage (Review B1): liegende Würfel sind feste Hindernisse. Gleiche Stoßzahl wie
    // Würfel gegen Würfel (Impuls × 0,9 bei gleicher Masse ⇒ 0,8 ⇒ gegen ein festes Hindernis × 1,8).
    // Hinausschieben höchstens 4 px je Schritt: ein über einem liegenden Würfel losgelassener Würfel
    // gleitet herunter statt zu springen.
    for (let i = 0; i < n; i++) for (const F of fixed) {
      const dx = P[i].x - F.x, dy = P[i].y - F.y, d = Math.hypot(dx, dy);
      if (d < 2 * R) {
        const nx = d > 0.01 ? dx / d : 0, ny = d > 0.01 ? dy / d : -1, ov = Math.min(2 * R - d, 4);
        P[i].x += nx * ov; P[i].y += ny * ov;
        const vn = V[i].x * nx + V[i].y * ny;
        if (vn < 0) { V[i].x -= vn * 1.8 * nx; V[i].y -= vn * 1.8 * ny; bounces.push(t); }
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

// ---------------------------------------------------------------- Endlage (Review B1)
// Abweichung zur Vorlage, vom Dirigenten freigegeben: in der Endlage liegt kein Würfel auf einem
// anderen, kein Schild auf einem anderen Schild oder auf einem fremden Würfel, kein Schild ragt aus
// dem Tisch. Alles rein und ohne Zufall; das gewürfelte Ergebnis ist davon unberührt.

export const TAG_LIFT = 30;   // Schild-Oberkante liegt so weit über der Würfel-Oberkante (dice.css .dt-tag)
export const SEP = 2 * R + 4; // Mindestabstand der Mittelpunkte in der Endlage (Würfelkante 64 px)
const GAP = 2;                // Luft zwischen Schildern bzw. Schild und fremdem Würfel
const STEP = 6;               // Raster der Platzsuche
const RELAX = 12;             // Runden des Auseinanderrückens vor der Platzsuche

/** Bereich für liegende Würfel: wie der Tisch, oben so weit eingerückt, dass das Schild im Tisch (box) bleibt. */
export function restArea(tray, box, half) {
  return { x0: tray.x0, x1: tray.x1, y0: Math.min(tray.y1, Math.max(tray.y0, box.y0 + half + TAG_LIFT)), y1: tray.y1 };
}

/**
 * Platzierung der Namensschilder: mittig über dem Würfel, waagrecht in den Tisch geschoben.
 * points = Würfel-Mittelpunkte, sizes = [{ w, h }] je Schild, box = { x0, x1, y0, y1 } (Tischfläche
 * für Schilder), half = halbe Würfelkante. dx = Versatz der Schildmitte gegen die Würfelmitte.
 * @returns {{ x: number, y: number, w: number, h: number, dx: number }[]}
 */
export function placeTags(points, sizes, box, half) {
  return points.map((p, i) => {
    const { w, h } = sizes[i];
    const x = Math.max(box.x0, Math.min(box.x1 - w, p.x - w / 2));
    const y = Math.max(box.y0, Math.min(box.y1 - h, p.y - half - TAG_LIFT));
    return { x, y, w, h, dx: x + w / 2 - p.x };
  });
}

const hit = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
const dieBox = (p, half) => ({ x: p.x - half, y: p.y - half, w: 2 * half, h: 2 * half });
/** Stören sich zwei liegende Würfel (Mittelpunkte p, q) samt Schildern (tp, tq)? */
function clash(p, tp, q, tq, half) {
  return Math.hypot(p.x - q.x, p.y - q.y) < SEP || hit(tp, tq) || hit(tp, dieBox(q, half)) || hit(tq, dieBox(p, half));
}

/** Prüft eine Endlage: alle Würfel im Ruhebereich, kein Paar stört sich. */
export function layoutFree(points, sizes, tray, box, half) {
  const A = restArea(tray, box, half), tags = placeTags(points, sizes, box, half);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < A.x0 || p.x > A.x1 || p.y < A.y0 || p.y > A.y1) return false;
    for (let j = 0; j < i; j++) if (clash(p, tags[i], points[j], tags[j], half)) return false;
  }
  return true;
}

/**
 * Ordentliche Endlage ohne Flug (reduzierte Bewegung) und Rückfall der Entzerrung: Würfel in
 * Reihen, so viele nebeneinander, wie die breitesten Schilder erlauben. near = Lagen, an denen sich
 * die Zuordnung orientiert (oben/unten, links/rechts bleiben erhalten); ohne near in Sitzreihenfolge.
 */
export function gridLayout(n, sizes, tray, box, half, near = null) {
  const A = restArea(tray, box, half), W = box.x1 - box.x0;
  const cell = Math.max(2 * half, ...sizes.map((s) => s.w)) + 2 * GAP;
  const rows = Math.ceil(n / Math.max(1, Math.min(n, Math.floor(W / cell))));
  const cols = Math.ceil(n / rows);
  const rowH = rows > 1 ? Math.min(2 * half + TAG_LIFT + 26, (A.y1 - A.y0) / (rows - 1)) : 0;
  const cx = (box.x0 + box.x1) / 2, cy = (A.y0 + A.y1) / 2;
  const order = near ? near.map((_, i) => i).sort((a, b) => near[a].y - near[b].y || a - b) : Array.from({ length: n }, (_, i) => i);
  const out = Array(n);
  for (let r = 0; r < rows; r++) {
    const ids = order.slice(r * cols, (r + 1) * cols);
    if (near) ids.sort((a, b) => near[a].x - near[b].x || a - b);
    ids.forEach((i, c) => {
      out[i] = clampToTray({ x: cx + (c - (ids.length - 1) / 2) * (W / cols), y: cy + (r - (rows - 1) / 2) * rowH }, A);
    });
  }
  return out;
}

/**
 * Entzerrung der Endlage. points = gewünschte Lagen aller Würfel (Geworfene: Ende der Bahn, Liegende:
 * ihre Lage), movable = Indizes der Geworfenen; Liegende bleiben unverändert. Jeder Geworfene bekommt
 * den nächsten freien Platz zu seinem Bahnende. Geht das nicht auf: ohne Liegende die Reihen-Lage
 * (gridLayout), mit Liegenden zurück auf die vorige Lage prev (die war frei, die Liegenden lagen schon so).
 * @returns {{ x: number, y: number }[]} Endlage aller Würfel
 */
export function settleLayout({ points, movable, sizes, tray, box, half, prev = null }) {
  const A = restArea(tray, box, half), n = points.length;
  const mov = new Set(movable);
  const P = points.map((p, i) => (mov.has(i) ? clampToTray(p, A) : { x: p.x, y: p.y }));
  const lying = P.map((_, i) => i).filter((i) => !mov.has(i));
  const tagAt = (i, p) => placeTags([p], [sizes[i]], box, half)[0];
  // Vorab auseinanderrücken: störende Paare teilen sich den Weg (waagrecht um die Schildbreite oder
  // senkrecht um Würfel + Schild, je nachdem was kürzer ist) ⇒ nicht ein Würfel allein wandert weit.
  for (let round = 0; round < RELAX; round++) {
    let moved = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const mi = mov.has(i), mj = mov.has(j);
      if ((!mi && !mj) || !clash(P[i], tagAt(i, P[i]), P[j], tagAt(j, P[j]), half)) continue;
      const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
      const needX = (sizes[i].w + sizes[j].w) / 2 + GAP + 1 - Math.abs(dx), needY = 2 * half + TAG_LIFT + GAP + 1 - Math.abs(dy);
      const alongX = needX <= needY, need = alongX ? needX : needY;
      const dir = (alongX ? dx : dy) > 0 || ((alongX ? dx : dy) === 0 && (i + j) % 2 === 0) ? 1 : -1;
      const si = mi ? (mj ? 0.5 : 1) : 0, sj = mj ? (mi ? 0.5 : 1) : 0;
      const pi = { x: P[i].x - (alongX ? dir * need * si : 0), y: P[i].y - (alongX ? 0 : dir * need * si) };
      const pj = { x: P[j].x + (alongX ? dir * need * sj : 0), y: P[j].y + (alongX ? 0 : dir * need * sj) };
      P[i] = mi ? clampToTray(pi, A) : P[i]; P[j] = mj ? clampToTray(pj, A) : P[j];
      moved = true;
    }
    if (!moved) break;
  }
  const maxRing = Math.ceil(Math.max(A.x1 - A.x0, A.y1 - A.y0) / STEP);
  const attempt = (order) => {
    const Q = P.slice(), T = Q.map((p, i) => tagAt(i, p)), placed = lying.slice();
    const free = (i, p, tp) => placed.every((j) => !clash(p, tp, Q[j], T[j], half));
    for (const i of order) {
      let best = free(i, Q[i], T[i]) ? Q[i] : null;
      for (let ring = 1; !best && ring <= maxRing; ring++) { // Ringe um das Bahnende, nächster freier Rasterpunkt
        let bd = Infinity;
        const probe = (a, b) => {
          const c = { x: P[i].x + a * STEP, y: P[i].y + b * STEP }, d = Math.hypot(a, b);
          if (d < bd && c.x >= A.x0 && c.x <= A.x1 && c.y >= A.y0 && c.y <= A.y1 && free(i, c, tagAt(i, c))) { bd = d; best = c; }
        };
        for (let a = -ring; a <= ring; a++) { probe(a, -ring); probe(a, ring); }
        for (let b = 1 - ring; b < ring; b++) { probe(-ring, b); probe(ring, b); }
      }
      if (!best) return null;
      Q[i] = best; T[i] = tagAt(i, best); placed.push(i);
    }
    return Q;
  };
  for (let k = 0; k < movable.length; k++) {
    const Q = attempt(movable.slice(k).concat(movable.slice(0, k)));
    if (Q) return Q;
  }
  if (!lying.length) return gridLayout(n, sizes, tray, box, half, P);
  return P.map((p, i) => (mov.has(i) && prev ? { x: prev[i].x, y: prev[i].y } : p));
}

/**
 * Rechnet die Endlage in die Bahn ein: der Versatz zum Bahnende wächst weich von 30 % der Flugzeit
 * bis zum Schluss von 0 auf 1 ⇒ kein Sprung, letzter Bahnpunkt = Endlage. t und d bleiben.
 */
export function blendPaths(paths, targets, dur, tray) {
  return paths.map((path, k) => {
    const e = path[path.length - 1], dx = targets[k].x - e.x, dy = targets[k].y - e.y;
    return path.map((q, j) => {
      if (j === path.length - 1) return { t: q.t, x: targets[k].x, y: targets[k].y, d: q.d };
      const u = Math.max(0, Math.min(1, (q.t / dur - 0.3) / 0.7)), w = u * u * (3 - 2 * u);
      const c = clampToTray({ x: q.x + dx * w, y: q.y + dy * w }, tray);
      return { t: q.t, x: c.x, y: c.y, d: q.d };
    });
  });
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
