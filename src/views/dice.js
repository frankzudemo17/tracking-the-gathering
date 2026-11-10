// Würfeltisch zum Startspieler-Auswürfeln (HANDOFF 5.4b, Spec P9, Mockup E2 Bildschirm 7, F5 = grüner Filz).
// Vollbild-Overlay: je Spieler ein W6 mit Namensschild. Antippen/Wischen wirft alle aktiven Würfel
// gemeinsam; gedrückt halten schüttelt. Höchster Wurf beginnt, bei Gleichstand werfen nur die
// Gleichstehenden nochmal. Während des Flugs wird nicht neu gerendert (WAAPI auf festen Elementen).
// Ergebnis steht vor der Bahn fest: randInt(6, appRand) + 1. Zufall nur über appRand.
// Endlage (Review B1): kein Würfel auf einem anderen, Schilder frei und im Tisch — gerechnet in
// src/game/dice.js (settleLayout/gridLayout/placeTags), mit Flug und bei reduzierter Bewegung.
import { html, mount, $, $$ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { appRand } from '../lib/rand.js';
import { randInt } from '../game/rng.js';
import {
  simDice, throwVelocity, spreadVelocities, faceRotation, holdOffset, startRow, clampToTray, startResult,
  placeTags, gridLayout, settleLayout, blendPaths,
} from '../game/dice.js';
import { t } from '../i18n/index.js';
import { buzz, reducedMotion } from '../lib/prefs.js';

const HALF = 32; // halbe Würfelgröße (64 px)
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_POS = { 1: 'rotateY(0deg)', 2: 'rotateY(90deg)', 3: 'rotateX(90deg)', 4: 'rotateX(-90deg)', 5: 'rotateY(-90deg)', 6: 'rotateY(180deg)' };
const TILT = [-8, 6, -12, 10, -4, 12]; // leichte Schräglage in Ruhe (fest, kein Zufall)
const INSET = { x: 44, y: 46 };         // Mittelpunkt-Abstand zum Filzrand (Main.dc.html diceTray)
const TAG_INSET = 12;                   // Namensschilder bleiben so weit im Filz (7 px Rand + Luft)

// Weniger Bewegung und Vibration nach den Tisch-Einstellungen (P7, src/lib/prefs.js): „System“ fragt
// prefers-reduced-motion; buzz() vibriert nur bei eingeschaltetem Schalter und vorhandener API (iOS: still nichts).
const reduced = () => reducedMotion();
const vibrate = (p) => buzz(p);
const innerTf = (r) => `rotateZ(${r.rz}deg) rotateX(${r.rx}deg) rotateY(${r.ry}deg)`;
const outerTf = (p, scale = 1) => `translate(${(p.x - HALF).toFixed(1)}px,${(p.y - HALF).toFixed(1)}px)${scale !== 1 ? ` scale(${scale.toFixed(3)})` : ''}`;
const joinNames = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} ${t('dice.and')} ${list[list.length - 1]}`);

const cube = () => html`${[1, 2, 3, 4, 5, 6].map((v) => html`<div class="dt-face f${v}" style="transform:${FACE_POS[v]} translateZ(28px)">${
  Array.from({ length: 9 }, (_, k) => html`<span>${PIPS[v].includes(k) ? html`<i></i>` : ''}</span>`)}</div>`)}`;

/**
 * Öffnet den Würfeltisch.
 * @param {HTMLElement} host  Elternelement des Overlays (Setup übergibt document.body)
 * @param {{ players: { seat: number, name: string }[], onAccept: (r: { winnerSeat: number, values: number[] }) => void }} opts
 * @returns {() => void} schließt ohne Übernehmen
 */
export function openDiceTable(host, { players, onAccept }) {
  const n = players.length;
  const opener = document.activeElement;
  const st = {
    values: Array(n).fill(null), active: players.map((_, i) => i), winner: null, tieAt: null,
    phase: 'ready', // ready · hold · fly · done
  };
  const pos = []; const rot = [];
  let tray = null, box = null, timers = [], anims = [], shakeT = null, gesture = null, closed = false;

  const root = document.createElement('div');
  root.className = 'dt';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.tabIndex = -1;
  root.setAttribute('aria-label', t('dice.label'));
  mount(root, html`
    <div class="dt-head"><div><small>${t('dice.eyebrow')}</small><h3>${t('dice.title')}</h3></div>
      <button type="button" class="icon-btn" data-dice="close" aria-label="${t('dice.close')}">${icon('close', 20)}</button></div>
    <div class="dt-felt" data-dice="felt" role="button" tabindex="0" aria-label="${t('dice.throw')}">
      <span class="dt-hint">${icon('handSwipeRight', 18)}${t('dice.hint')}</span></div>
    <div class="dt-layer" aria-hidden="true">${players.map((p, i) => html`<div class="dt-die" data-die="${i}">
      <div class="dt-shadow"></div><span class="dt-tag"></span>
      <div class="dt-wrap"><div class="dt-cube">${cube()}</div></div></div>`)}</div>
    <div class="dt-foot"><div class="dt-status" role="status" aria-live="polite"><b></b><span></span></div>
      <button type="button" class="btn block dt-accept" data-dice="accept" hidden></button></div>`);
  host.appendChild(root);

  const felt = $('[data-dice="felt"]', root);
  const dieEls = $$('.dt-die', root);
  const el = dieEls.map((d) => ({ outer: d, inner: $('.dt-cube', d), tag: $('.dt-tag', d) }));

  // ---------- Maße (echte Pixel, relativ zum Overlay)
  function measure() {
    const r = root.getBoundingClientRect(), f = felt.getBoundingClientRect();
    tray = { x0: f.left - r.left + INSET.x, x1: f.right - r.left - INSET.x, y0: f.top - r.top + INSET.y, y1: f.bottom - r.top - INSET.y };
    if (tray.x1 < tray.x0) tray.x0 = tray.x1 = (tray.x0 + tray.x1) / 2;
    if (tray.y1 < tray.y0) tray.y0 = tray.y1 = (tray.y0 + tray.y1) / 2;
    box = { x0: f.left - r.left + TAG_INSET, x1: f.right - r.left - TAG_INSET, y0: f.top - r.top + TAG_INSET, y1: f.bottom - r.top - TAG_INSET };
  }
  function place(i, p, scale = 1) { el[i].outer.style.transform = outerTf(p, scale); }
  function turn(i) { el[i].inner.style.transform = innerTf(rot[i]); }
  /**
   * Startreihe + Schildbreite. Enge Startreihe: Namensschilder abwechselnd hoch/tief (lesbar statt
   * überlappend). Breite zusätzlich so begrenzt, dass in der Endlage 2 (bis 4 Spieler) bzw. 3 Schilder
   * nebeneinander in den Tisch passen ⇒ die Reihen-Lage (gridLayout) geht immer auf.
   */
  function fitTags() {
    const row = startRow(n, tray);
    const gap = n > 1 ? row[1].x - row[0].x : 999;
    const cap = Math.floor((box.x1 - box.x0) / (n <= 2 ? Math.max(1, n) : n <= 4 ? 2 : 3)) - 4;
    root.classList.toggle('crowd', gap < 100);
    root.style.setProperty('--dt-tagw', `${Math.round(Math.max(52, Math.min(140, (gap < 100 ? 2 * gap : gap) - 6, cap)))}px`);
    return row;
  }
  const tagText = (i, v) => (v == null ? players[i].name : `${players[i].name} · ${v}`);
  /** Maße des Schilds von Würfel i mit dem Text für Wert v (am echten Element gemessen, ohne Skalierung). */
  function tagSize(i, v) {
    const tag = el[i].tag, old = tag.textContent;
    tag.textContent = tagText(i, v);
    const size = { w: tag.offsetWidth + 1, h: tag.offsetHeight }; // + 1: offsetWidth rundet
    tag.textContent = old;
    return size;
  }
  /** Schiebt die Schilder für die Endlage end waagrecht in den Tisch (--dt-tx); move legt auch die Würfel dorthin. */
  function lay(end, sizes, move = true) {
    const tags = placeTags(end, sizes, box, HALF);
    end.forEach((p, i) => {
      el[i].outer.style.setProperty('--dt-tx', `${tags[i].dx.toFixed(1)}px`);
      if (!move) return;
      pos[i] = { x: p.x, y: p.y };
      el[i].outer.style.transition = 'none';
      place(i, pos[i]);
    });
  }

  measure();
  fitTags().forEach((p, i) => {
    pos[i] = p;
    rot[i] = { rz: TILT[i % TILT.length], rx: 0, ry: 0 };
    const [rx, ry] = faceRotation((i % 6) + 1); rot[i].rx = rx; rot[i].ry = ry;
    place(i, p); turn(i);
  });

  // ---------- Anzeige (nur Texte/Klassen; die Würfel-Elemente bleiben bestehen)
  function paint() {
    const done = st.winner != null;
    players.forEach((p, i) => {
      const v = st.values[i];
      el[i].tag.textContent = tagText(i, v);
      el[i].outer.classList.toggle('idle', !done && !st.active.includes(i));
      el[i].outer.classList.toggle('win', done && st.winner === i);
    });
    const b = $('.dt-status b', root), s = $('.dt-status span', root), acc = $('[data-dice="accept"]', root);
    if (done) {
      const name = players[st.winner].name;
      b.textContent = t('dice.winner', { name });
      s.textContent = t('dice.winnerSub', { n: st.values[st.winner] });
      acc.textContent = t('dice.accept', { name });
      acc.hidden = false;
    } else if (st.tieAt != null) {
      b.textContent = t('dice.tie', { n: st.tieAt });
      s.textContent = t('dice.tieSub', { names: joinNames(st.active.map((i) => players[i].name)) });
      acc.hidden = true;
    } else {
      b.textContent = t('dice.ready');
      s.textContent = t('dice.readySub');
      acc.hidden = true;
    }
    root.dataset.phase = done ? 'done' : st.tieAt != null ? 'tie' : st.phase;
    felt.setAttribute('aria-disabled', String(done));
  }
  paint();

  // ---------- Geste
  const local = (e) => { const r = root.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const canThrow = () => !closed && st.winner == null && (st.phase === 'ready' || st.phase === 'done');

  function holdAt(p, animated) {
    st.active.forEach((i, k) => {
      const o = holdOffset(k, st.active.length);
      el[i].outer.style.transition = animated ? 'transform .14s ease-out' : 'none';
      place(i, clampToTray({ x: p.x + o.x, y: p.y + o.y }, tray), 1.14);
    });
  }

  function onDown(e) {
    if (!canThrow() || (e.button != null && e.button !== 0)) return;
    e.preventDefault();
    measure();
    if (reduced()) { throwNow(null); return; } // kein Halten, kein Schütteln, kein Flug
    const p = local(e);
    gesture = { id: e.pointerId, samples: [{ t: performance.now(), ...p }] };
    st.phase = 'hold'; root.dataset.phase = 'hold';
    holdAt(p, true);
    let tick = 0;
    shakeT = setInterval(() => {
      tick++;
      st.active.forEach((i, k) => { // leichtes Schütteln, feste Folge (kein Zufall nötig)
        el[i].inner.style.transition = 'transform .1s linear';
        el[i].inner.style.transform = innerTf({ rz: (tick * 137 + k * 59) % 360, rx: (tick * 211 + k * 97) % 360, ry: (tick * 89 + k * 173) % 360 });
      });
    }, 110);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  function onMove(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const p = local(e);
    gesture.samples.push({ t: performance.now(), ...p });
    if (gesture.samples.length > 400) gesture.samples.splice(1, 1); // erster Punkt bleibt (Wegstrecke)
    holdAt(p, false);
  }
  function release(e, cancelled) {
    if (!gesture || e.pointerId !== gesture.id) return;
    stopGesture();
    const g = gesture; gesture = null;
    // Abbruch (pointercancel) ⇒ Wurf mit den bisherigen Punkten
    if (!cancelled) g.samples.push({ t: performance.now(), ...local(e) });
    throwNow(g.samples);
  }
  const onUp = (e) => release(e, false);
  const onCancel = (e) => release(e, true);
  function stopGesture() {
    clearInterval(shakeT); shakeT = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  // ---------- Wurf
  function throwNow(samples) {
    const act = st.active.slice();
    const vals = act.map(() => randInt(6, appRand) + 1); // Ergebnis zuerst, dann die Bahn
    const next = st.values.slice(); act.forEach((i, k) => { next[i] = vals[k]; });
    const sizes = players.map((_, i) => tagSize(i, next[i])); // Schilder mit dem Ergebnistext
    const geo = { sizes, tray, box, half: HALF };
    if (!samples || reduced()) {
      // ohne Flug: Erstwurf ⇒ Reihen in Sitzreihenfolge; Nachwurf ⇒ die Würfel liegen schon frei und bleiben
      const first = st.values.every((v) => v == null);
      settle(act, vals, first ? gridLayout(n, sizes, tray, box, HALF) : settleLayout({ points: pos, movable: act, prev: pos, ...geo }), sizes, null);
      return;
    }
    st.phase = 'fly'; root.dataset.phase = 'fly';
    const base = throwVelocity(samples, appRand);
    const vels = spreadVelocities(base, act.length, appRand);
    const rel = clampToTray(samples[samples.length - 1], tray);
    const starts = act.map((_, k) => { const o = holdOffset(k, act.length); return clampToTray({ x: rel.x + o.x, y: rel.y + o.y }, tray); });
    // Liegende Würfel (Nachwurf) sind Hindernisse; danach die Endlage entzerren und in die Bahn einrechnen
    const sim = simDice(starts, vels, tray, pos.filter((_, i) => !act.includes(i)));
    const want = pos.map((p) => ({ x: p.x, y: p.y }));
    act.forEach((i, k) => { const e = sim.path[k][sim.path[k].length - 1]; want[i] = { x: e.x, y: e.y }; });
    const end = settleLayout({ points: want, movable: act, prev: pos, ...geo });
    const paths = blendPaths(sim.path, act.map((i) => end[i]), sim.dur, tray);
    lay(end, sizes, false); // Schilder gleiten schon im Flug an ihren Platz
    const ease = (p) => 1 - Math.pow(1 - p, 2.2);
    const T1 = Math.min(520, sim.dur * 0.45);
    const lift = (tt) => (tt < T1 ? Math.sin(Math.PI * tt / T1) * 0.38 : (tt < T1 * 1.55 ? Math.sin(Math.PI * (tt - T1) / (T1 * 0.55)) * 0.12 : 0));
    const rots = [];
    act.forEach((i, k) => {
      const path = paths[k]; const total = Math.max(1, sim.dist[k]);
      const spin = 360 + total * 1.15;
      const r0 = rot[i];
      const [tx, ty] = faceRotation(vals[k]);
      const rzF = Math.round(appRand() * 40 - 20) + 360 * Math.round(total / 500);
      const rxF = tx + 360 * Math.ceil((r0.rx + spin - tx) / 360);
      const ryF = ty + 360 * Math.ceil((r0.ry + spin * 0.7 - ty) / 360);
      const kfO = [{ offset: 0, transform: outerTf(starts[k], 1) }], kfI = [{ offset: 0, transform: innerTf(r0) }];
      path.forEach((q) => {
        const off = Math.min(1, q.t / sim.dur), pr = ease(q.d / total);
        kfO.push({ offset: off, transform: outerTf(q, 1 + lift(q.t)) });
        kfI.push({ offset: off, transform: innerTf({ rz: (r0.rz + (rzF - r0.rz) * pr).toFixed(1), rx: (r0.rx + (rxF - r0.rx) * pr).toFixed(1), ry: (r0.ry + (ryF - r0.ry) * pr).toFixed(1) }) });
      });
      kfO[kfO.length - 1].offset = 1; kfI[kfI.length - 1].offset = 1;
      el[i].outer.style.transition = 'none'; el[i].inner.style.transition = 'none';
      if (el[i].outer.animate) {
        anims.push(el[i].outer.animate(kfO, { duration: sim.dur, easing: 'linear', fill: 'forwards' }));
        anims.push(el[i].inner.animate(kfI, { duration: sim.dur, easing: 'linear', fill: 'forwards' }));
      }
      rots[k] = { rz: ((rzF % 360) + 360) % 360, rx: tx, ry: ty };
    });
    [...new Set(sim.bounces.map((b) => Math.round(b / 60) * 60))].slice(0, 6).forEach((b) => timers.push(setTimeout(() => vibrate(12), b)));
    timers.push(setTimeout(() => { vibrate([20, 40, 30]); settle(act, vals, end, sizes, rots); }, sim.dur + 40));
  }

  /** Endzustand setzen, Animationen abbrechen, dann Zustand aktualisieren (HANDOFF 5.4b). */
  function settle(act, vals, end, sizes, rots) {
    if (closed) return;
    lay(end, sizes); // letzter Bahnpunkt = Endlage ⇒ kein Sprung
    act.forEach((i, k) => {
      if (rots) rot[i] = rots[k];
      else { const [rx, ry] = faceRotation(vals[k]); rot[i] = { rz: TILT[i % TILT.length], rx, ry }; }
      el[i].inner.style.transition = 'none';
      turn(i);
      st.values[i] = vals[k];
    });
    anims.forEach((a) => { try { a.cancel(); } catch { /* schon weg */ } });
    anims = []; timers.forEach(clearTimeout); timers = [];
    const res = startResult(st.values, act);
    if (res.tie) { st.active = res.tie; st.tieAt = st.values[res.tie[0]]; }
    else { st.winner = res.winnerSeat; st.active = []; }
    st.phase = 'done';
    paint();
  }

  // ---------- Schließen / Übernehmen
  function close() {
    if (closed) return;
    closed = true;
    stopGesture(); gesture = null;
    timers.forEach(clearTimeout); timers = [];
    anims.forEach((a) => { try { a.cancel(); } catch { /* schon weg */ } }); anims = [];
    window.removeEventListener('resize', onResize);
    window.removeEventListener('hashchange', close);
    document.removeEventListener('keydown', onKey);
    root.remove();
    if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
  }
  /** Nach „übernehmen“ rendert das Setup neu: der Auslöser ist ersetzt ⇒ Fokus auf sein Gegenstück (gleiche id/data-*). */
  function refocus() {
    if (!(opener instanceof HTMLElement) || opener.isConnected) return;
    const marks = [...opener.attributes].filter((a) => a.name === 'id' || a.name.startsWith('data-'));
    const twin = marks.length ? document.querySelector(opener.localName + marks.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('')) : null;
    if (twin instanceof HTMLElement && !twin.hasAttribute('disabled')) twin.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { // Fokus bleibt im Dialog
      const f = $$('button:not([hidden]), [tabindex="0"]', root);
      const at = f.indexOf(document.activeElement);
      const next = e.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : (at + 1) % f.length;
      e.preventDefault(); f[next]?.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target === felt) { e.preventDefault(); if (canThrow()) {
      measure(); // Tastatur: Wurf aus der Mitte der aktiven Würfel, wie ein Tippen
      const c = st.active.reduce((a, i) => ({ x: a.x + pos[i].x / st.active.length, y: a.y + pos[i].y / st.active.length }), { x: 0, y: 0 });
      throwNow(reduced() ? null : [{ t: performance.now(), ...c }]);
    } }
  }
  function onResize() {
    if (st.phase === 'fly' || st.phase === 'hold') return;
    measure(); fitTags();
    const sizes = players.map((_, i) => tagSize(i, st.values[i]));
    const at = pos.map((p) => clampToTray(p, tray));
    // vor dem ersten Wurf nur in den Tisch klemmen; danach die Endlage für den neuen Tisch neu entzerren
    lay(st.values.every((v) => v == null) ? at : settleLayout({ points: at, movable: players.map((_, i) => i), sizes, tray, box, half: HALF }), sizes);
  }

  root.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-dice="felt"]')) onDown(e); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dice]');
    if (!b) return;
    if (b.dataset.dice === 'close') close();
    else if (b.dataset.dice === 'accept' && st.winner != null) {
      const values = Array(n).fill(null);
      players.forEach((p, i) => { values[p.seat] = st.values[i]; }); // je Sitz der letzte Wert
      const r = { winnerSeat: players[st.winner].seat, values };
      close();
      onAccept?.(r);
      refocus();
    }
  });
  window.addEventListener('resize', onResize);
  window.addEventListener('hashchange', close);
  document.addEventListener('keydown', onKey);
  root.focus({ preventScroll: true });
  return close;
}
