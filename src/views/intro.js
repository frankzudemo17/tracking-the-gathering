// Spielstart-Intro (Spec P3 + P8 „Intro 2.0“, Welle ttg-features): vor dem ersten Zug je Spieler eine Karte auf
// einem Spieltisch (Filz wie der Würfeltisch). Die ganze Commander-Karte fliegt aus Richtung des Spielerfelds herein
// und knallt auf den Filz (Aufprall, Lichtring, Funken, Schatten), darunter blendet die Info-Tafel ein: Name, Deck,
// Deck-Bilanz, Salz, Bracket, Motto oder automatische Zeile (Inhalte und Texte aus P3). Farben nur aus Tokens
// (--hero-ink, --hero-mu, „Beginnt“ in --turn); Tisch/Filz als lokale Größen --in-* in intro.css.
//
//   showIntro(host, { groupId, players, onDone }) ⇒ close()
//     host     Element der Spielansicht (Wurzel wird dort angehängt; fällt sie heraus ⇒ schließen; Feldlage für den Anflug)
//     groupId  Gruppe des Spiels (Deck-Bilanz und Salz aus groupData, Liegezeit aus playgroups.intro_seconds)
//     players  [{ id, seat, name, deck }] schon in Zugreihenfolge (introOrder), deck = Zeile aus g.decks oder null
//     onDone() wird genau einmal gerufen, NACH dem Abräumen (Ablauf zu Ende, Überspringen, Escape, Seitenwechsel, close())
//
// Ablauf: Laden parallel (decks select('*'), groupData, Deckliste je Deck, frische Gruppenzeile); Kartenbilder werden
// beim Öffnen (aus g.decks) und nach dem Laden (Deckliste, scryfall_ids) vorgeladen. Die erste Karte erscheint, sobald
// alle Quellen erledigt und die Bilder von Karte 1 geladen oder gescheitert sind, spätestens nach INTRO_WAIT_MS. Die
// Liegezeit wird beim Erscheinen der ersten Karte einmal festgelegt (frische Zeile ⇒ Mitgliedschaft ⇒ 4 s). Jede Karte
// wird gebaut, wenn sie erscheint, und ändert sich danach nicht; ist ihr Bild dann nicht fertig ⇒ Rückfall (art_crop-
// Kachel bzw. Initialen), nie warten. Weiter nach flyMs + Liegezeit oder auf click (nie pointerdown); nach dem Schließen
// ein unsichtbarer Klick-Schild. Gesteuert wird nur über Zeitgeber (nie über animationend/finished); Animationen mit
// element.animate, nur transform und opacity; beim Wechsel/Schließen cancel(). Weniger Bewegung ⇒ Karte liegt sofort,
// Einblenden 200 ms (opacity), gleiche Liegezeit.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { html, mount, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { manaPips } from '../lib/parts.js';
import { reducedMotion } from '../lib/prefs.js';
import { groupData } from '../lib/data.js';
import { deckProfile } from '../lib/stats.js';
import { loadDeckCards, deckTraits } from '../decks/cards.js';
import { sortColors } from '../lib/decks.js';
import { t, getLang } from '../i18n/index.js';
import { cmdLine } from './life-ui.js';
import { cardImages, preloadCardImages, imageState, whenReady } from '../lib/card-images.js';
import {
  INTRO_WAIT_MS, INTRO_FADE_MS, INTRO_SECONDS_DEFAULT, introSeconds, introTiming, flightFrom, tiltFor,
  recordText, saltText, cardLine, fill,
} from './intro-ui.js';

const SHIELD_MS = 350;
const CARD_RATIO = 680 / 488; // Scryfall normal (Höhe / Breite)
const IMPACT = 560; // ms ab Kartenstart: Karte trifft den Filz (Entscheid 8)
const SPARKS = 10;
const cssUrl = (u) => `url('${String(u).replace(/'/g, '%27')}')`;
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/** Unsichtbarer Klick-Schild nach dem Schließen (Muster ko.js shield(), eigene Klasse). */
function shield() {
  const s = document.createElement('div');
  s.className = 'intro-shield';
  s.setAttribute('aria-hidden', 'true');
  document.body.append(s);
  setTimeout(() => s.remove(), SHIELD_MS);
}

/**
 * Daten parallel laden; jede Quelle trägt ihr Ergebnis ein, sobald sie fertig ist (Fehler ⇒ still leer).
 * `onData` nach jeder Deck-Quelle (Vorladen der Kartenbilder aus Deckliste/scryfall_ids).
 * @param {string} groupId
 * @param {string[]} deckIds
 * @param {() => void} onData
 */
function loadAll(groupId, deckIds, onData) {
  const got = { rows: null, data: null, cards: new Map(), group: null };
  const jobs = [];
  if (deckIds.length) {
    // immer select('*'): ohne Spalte motto (Datenbank vor der Migration) fehlt nur der Schlüssel, keine 400
    jobs.push(Promise.resolve().then(() => sb.from('decks').select('*').in('id', deckIds))
      .then((r) => { if (!r?.error && Array.isArray(r?.data)) { got.rows = new Map(r.data.map((d) => [d.id, d])); onData(); } })
      .catch(() => {}));
    for (const id of deckIds) {
      jobs.push(Promise.resolve().then(() => loadDeckCards(sb, id))
        .then((rows) => { got.cards.set(id, rows); onData(); })
        .catch(() => {}));
    }
  }
  if (groupId) {
    jobs.push(Promise.resolve().then(() => groupData.loadGroup(groupId))
      .then((data) => { got.data = data || null; })
      .catch(() => {}));
    // Liegezeit (P8 Entscheid 4): select('*') — ohne Spalte (DB vor der Migration) fehlt nur der Schlüssel, keine 400
    jobs.push(Promise.resolve().then(() => sb.from('playgroups').select('*').eq('id', groupId).maybeSingle())
      .then((r) => { if (!r?.error && r?.data) got.group = r.data; })
      .catch(() => {}));
  }
  return { got, all: Promise.all(jobs) };
}

/** Deck eines Spielers mit frischer Zeile (falls da). */
function deckOf(p, got) {
  const base = p.deck || null;
  const row = base && got.rows ? got.rows.get(base.id) || null : null;
  return { base, row, deck: base ? { ...base, ...(row || {}) } : null };
}

/** Adressen der ganzen Karte(n) eines Spielers aus dem, was gerade da ist; null ⇒ keine Quelle. */
function urlsOf(p, got) {
  const { base, row } = deckOf(p, got);
  return base ? cardImages(base, row, got.cards.get(base.id) || null) : null;
}

/** Info-Tafel (Inhalte und Regeln aus P3, cardView). */
function panelView(p, i, deck, row, got, L, lang) {
  const facts = [];
  let line = null;
  if (deck) {
    let dp = null;
    try { dp = got.data ? deckProfile(got.data, deck.id) : null; } catch { dp = null; }
    const rec = recordText(dp, L);
    const salt = saltText(dp, lang);
    if (rec) facts.push(html`<span class="intro-fact" data-fact="record">${icon('trophy', 15)}${rec}</span>`);
    if (salt) facts.push(html`<span class="intro-fact" data-fact="salt" title="${L.salt}">${icon('salt', 15)}<span class="sr-only">${L.salt} </span>${salt}</span>`);
    if (row && Number.isFinite(row.bracket)) facts.push(html`<span class="intro-fact" data-fact="bracket">${fill(L.bracket, { n: row.bracket })}</span>`);
    const rows = got.cards.get(deck.id);
    const traits = Array.isArray(rows) ? deckTraits(rows, deck) : null;
    // Motto nur aus der frisch geladenen Zeile; g.decks kennt die Spalte nicht
    line = cardLine(row ? deck : { ...deck, motto: null }, traits, L, lang);
  }
  return html`<div class="intro-panel intro-text">
      ${i === 0 ? html`<span class="intro-first"><i aria-hidden="true"></i>${L.first}</span>` : ''}
      <h2 class="intro-name">${p.name}</h2>
      ${deck ? html`<div class="intro-deck">${manaPips(sortColors(deck.color_identity || []), 12)}<span>${cmdLine(deck)}</span></div>` : ''}
      ${facts.length ? html`<div class="intro-facts">${facts}</div>` : ''}
      ${line ? html`<p class="intro-line ${line.kind}" data-line="${line.kind}">${line.kind === 'motto' ? fill(L.motto, { text: line.text }) : line.text}</p>` : ''}
    </div>`;
}

/**
 * Karte eines Spielers: Bildplatz (ganze Karte, art_crop-Kachel oder Initialen) + Info-Tafel.
 * Bildart wird beim Start der Karte entschieden: alle Adressen 'ok' ⇒ card, sonst art_crop ⇒ art, sonst none.
 */
/** art_crop-Adressen eines Decks (Kommandeur, Partner) */
const artsOf = (deck) => (deck ? [deck.image_url, deck.partner_image_url].filter((u) => typeof u === 'string' && u) : []);

function cardView(p, i, got, L, lang, still) {
  const { deck, row } = deckOf(p, got);
  const urls = urlsOf(p, got);
  // art_crop-Kacheln (Rückfall); bekannt fehlgeschlagene fallen weg, fehlen alle ⇒ Initialen statt leerer Kachel
  const arts = artsOf(deck).filter((u) => imageState(u) !== 'err');
  const kind = urls && urls.every((u) => imageState(u) === 'ok') ? 'card' : arts.length ? 'art' : 'none';
  const items = kind === 'card' ? urls : kind === 'art' ? arts : [null];
  const fx = !still && kind !== 'none';
  const pieces = items.map((u) => html`<div class="intro-place">
      <i class="intro-shadow" aria-hidden="true"></i>
      <div class="intro-fly">${kind === 'card'
        ? html`<img class="intro-cardimg" src="${u}" alt="" aria-hidden="true" draggable="false">`
        : kind === 'art'
          ? html`<i class="intro-tile" aria-hidden="true" style="background-image:${cssUrl(u)}"></i>`
          : html`<span class="intro-ini" aria-hidden="true">${initials(p.name)}</span>`}</div>
    </div>`);
  return html`<div class="intro-card" data-intro-card="${i}" data-pid="${p.id}" data-img="${kind}" data-phase="${still ? 'lie' : 'fly'}">
    <div class="intro-slot ${items.length > 1 ? 'pair' : ''}" aria-hidden="true">
      ${fx ? html`<i class="intro-ring"></i><i class="intro-sparks">${Array.from({ length: SPARKS }, (_, k) => html`<i class="intro-spark" data-k="${k}"></i>`)}</i>` : ''}
      ${pieces}
    </div>
    ${panelView(p, i, deck, row, got, L, lang)}
  </div>`;
}

/**
 * Maße setzen (Entscheid 7): Einzelkarte Höhe = min(50 % Filz, 400 px, Platz über der Tafel), Breite daraus, höchstens
 * Filzbreite − 40; Partner nebeneinander (10 px Abstand), je min((Filzbreite − 50) / 2, Einzelbreite). Kachel 4 : 3.
 */
function layout(card, felt) {
  const fw = felt.clientWidth;
  const fh = felt.clientHeight;
  const panel = /** @type {HTMLElement} */ (card.querySelector('.intro-panel'));
  const cs = getComputedStyle(card);
  const padT = parseFloat(cs.paddingTop) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;
  const gap = parseFloat(cs.rowGap) || 0;
  const room = fh - padT - padB - gap - (panel?.offsetHeight || 0);
  let h = Math.max(120, Math.min(fh * 0.5, 400, room));
  let w = h / CARD_RATIO;
  if (w > fw - 40) { w = fw - 40; h = w * CARD_RATIO; }
  const places = /** @type {NodeListOf<HTMLElement>} */ (card.querySelectorAll('.intro-place'));
  const kind = card.dataset.img;
  const pair = places.length > 1;
  const pw = pair ? Math.min((fw - 50) / 2, w) : w;
  let cw, ch;
  if (kind === 'card') { cw = pw; ch = pw * CARD_RATIO; }
  else if (kind === 'art') { cw = pair ? pw * 1.0 : Math.min(fw - 40, h * 4 / 3); ch = cw * 3 / 4; if (ch > h) { ch = h; cw = ch * 4 / 3; } }
  else { cw = ch = Math.min(128, h); }
  for (const pl of places) { pl.style.width = `${Math.round(cw)}px`; pl.style.height = `${Math.round(ch)}px`; }
  const img = /** @type {HTMLElement[]} */ ([...card.querySelectorAll('.intro-cardimg')]);
  for (const im of img) im.style.borderRadius = `${Math.round(cw * 0.045)}px`; // nur die Kartenrundung (≈ 4,5 % der Breite)
  return { cw, ch };
}

export function showIntro(host, { groupId, players, onDone }) {
  const L = t('intro');
  const lang = getLang();
  const list = Array.isArray(players) ? players : [];
  const n = list.length;
  const still = reducedMotion();
  let done = false;
  let idx = -1; // -1 = Bühne wartet auf Daten und Bild 1
  let timer = null;
  let lieTimer = null;
  let goTimer = null;
  let fadeTimer = null; // Weniger Bewegung: alte Karte nach dem Überblenden entfernen
  /** vorab gebaute Karten-Ansichten (Index ⇒ { sig, view }), gebaut in Ruhezeiten statt im Start-Takt der Karte */
  const views = new Map();
  /** @type {Animation[]} */
  let anims = [];
  /** @type {{ flyMs: number, lieMs: number, cardMs: number } | null} */
  let timing = null;

  const root = document.createElement('div');
  root.className = `intro${still ? ' intro-still' : ''}`;
  root.dataset.intro = '';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', L.label);
  mount(root, html`<div class="intro-felt" aria-hidden="true"></div>
    <div class="intro-stage" data-intro-stage></div>
    <div class="intro-top">
      <div class="intro-prog" aria-hidden="true" data-intro-prog>${list.map(() => html`<i><b></b></i>`)}</div>
      <button type="button" class="intro-skip" data-intro-skip>${L.skip}${icon('close', 16)}</button>
    </div>
    <p class="sr-only" aria-live="polite" data-intro-live></p>`);
  const felt = /** @type {HTMLElement} */ (root.querySelector('.intro-felt'));
  const stage = /** @type {HTMLElement} */ (root.querySelector('[data-intro-stage]'));
  const prog = root.querySelector('[data-intro-prog]');
  const live = root.querySelector('[data-intro-live]');

  // Vorladen (b): beim Öffnen aus g.decks (Quelle 1); (c): nach jeder Deck-Quelle für Karten, die jetzt eine Adresse haben
  // ganze Karten vorladen; die art_crop-Kacheln auch (meist schon im Cache vom Tisch), damit ein Fehlschlag vor der Karte bekannt ist
  const preloadAll = () => { for (const p of list) preloadCardImages([...(urlsOf(p, got) || []), ...artsOf(deckOf(p, got).deck)]); };
  const deckIds = [...new Set(list.map((p) => p.deck?.id).filter(Boolean))];
  const { got, all } = loadAll(groupId, deckIds, () => { if (!done) preloadAll(); });
  preloadAll();

  /** Liegezeit (Entscheid 4): frische Zeile mit Schlüssel ⇒ Mitgliedschaft mit Schlüssel ⇒ 4. */
  function pickSeconds() {
    if (has(got.group, 'intro_seconds')) return introSeconds(got.group.intro_seconds);
    const m = (state.memberships || []).find((x) => x.playgroup_id === groupId)?.playgroups;
    if (has(m, 'intro_seconds')) return introSeconds(m.intro_seconds);
    return INTRO_SECONDS_DEFAULT;
  }

  const stopAnims = () => { for (const a of anims) { try { a.cancel(); } catch { /* schon weg */ } } anims = []; };
  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (lieTimer) { clearTimeout(lieTimer); lieTimer = null; }
    if (goTimer) { clearTimeout(goTimer); goTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    stopAnims();
  };
  /** Was die Ansicht einer Karte bestimmt: geladene Quellen + Bildstand (ändert sich das, wird neu gebaut). */
  const sigOf = (p) => {
    const urls = urlsOf(p, got) || [];
    return [got.rows ? got.rows.size : -1, got.cards.size, got.data ? 1 : 0,
      ...urls, ...urls.map(imageState), ...artsOf(deckOf(p, got).deck).map(imageState)].join('|');
  };
  /** Ansicht von Karte k vorab bauen (P8 K21: Daten/Statistik nicht im Start-Takt der Karte). */
  const prep = (k) => {
    if (done || k < 0 || k >= n) return;
    const sig = sigOf(list[k]);
    if (views.get(k)?.sig !== sig) views.set(k, { sig, view: cardView(list[k], k, got, L, lang, still) });
  };
  const viewOf = (k) => {
    const sig = sigOf(list[k]);
    const c = views.get(k);
    return c && c.sig === sig ? c.view : cardView(list[k], k, got, L, lang, still);
  };
  const teardown = () => {
    clear();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onLeave);
    mo.disconnect();
    root.remove();
  };
  const finish = () => {
    if (done) return;
    done = true;
    teardown();
    shield();
    try { onDone?.(); } catch (e) { console.error(e); }
  };

  function paintProgress() {
    const segs = prog.children;
    for (let k = 0; k < segs.length; k++) {
      const s = /** @type {HTMLElement} */ (segs[k]);
      s.className = k < idx ? 'done' : k === idx ? 'cur' : '';
      // aktuelles Segment neu anlegen ⇒ die Füllbewegung beginnt wieder bei 0
      if (k === idx) mount(s, html`<b></b>`);
    }
  }

  /** WAAPI-Animation merken (für cancel beim Wechsel/Schließen). Ohne animate (alte Engine) still nichts. */
  function run(el, frames, opts) {
    if (!el || typeof el.animate !== 'function') return;
    try { anims.push(el.animate(frames, opts)); } catch { /* ohne Animation weiter */ }
  }

  /** „Karte knallt auf den Tisch“ (Entscheid 8): Anflug 0–560, Aufprall 560–900, Tafel ab 560; alles endet bei 900. */
  function animateIn(card, p, { cw, ch }) {
    const fly = timing.flyMs;
    const fieldSel = `.lc-field[data-pid="${globalThis.CSS?.escape ? CSS.escape(p.id) : p.id}"]`;
    const rect = host?.querySelector?.(fieldSel)?.getBoundingClientRect() || null;
    const { x, y, dir } = flightFrom(rect, innerWidth, innerHeight);
    const places = /** @type {HTMLElement[]} */ ([...card.querySelectorAll('.intro-place')]);
    const pair = places.length > 1;
    const base = tiltFor(p.seat);
    places.forEach((pl, j) => {
      const tilt = pair ? Math.max(-1, Math.min(1, base)) * (j ? -1 : 1) : base; // Partner: ± 1°
      const flyEl = /** @type {HTMLElement} */ (pl.querySelector('.intro-fly'));
      const sh = pl.querySelector('.intro-shadow');
      flyEl.style.transform = `rotate(${tilt}deg)`;
      flyEl.style.willChange = 'transform';
      const delay = j ? 120 : 0; // zweite Karte 120 ms später, liegt zur selben Zeit
      const dur = fly - delay;
      const at = (ms) => Math.max(0, Math.min(1, (ms - delay) / dur));
      const T = (tx, ty, s, rx, ry, rz) => `translate3d(${tx}px, ${ty}px, 0) scale(${s}) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
      run(flyEl, [
        { offset: 0, transform: T(x, y, 1.5, 50, dir * 25, tilt - dir * 160), easing: 'ease-in' },
        { offset: at(IMPACT), transform: T(0, 0, 0.97, 0, 0, tilt - dir * 2.5), easing: 'ease-out' },
        { offset: at(IMPACT + 90), transform: T(0, 0, 1.015, 0, 0, tilt + dir * 1.5), easing: 'ease-in-out' },
        { offset: at(IMPACT + 190), transform: T(0, 0, 1, 0, 0, tilt - dir * 0.8), easing: 'ease-in-out' },
        { offset: at(IMPACT + 280), transform: T(0, 0, 1, 0, 0, tilt + dir * 0.3), easing: 'ease-out' },
        { offset: 1, transform: T(0, 0, 1, 0, 0, tilt) },
      ], { duration: dur, delay, fill: 'backwards' });
      // Schatten: in der Luft weit und blass, liegt eng und dunkel (Ruhe = CSS)
      run(sh, [
        { offset: 0, opacity: 0, transform: `translate3d(${Math.round(x * 0.08)}px, ${Math.round(y * 0.08) + 40}px, 0) scale(1.7)` },
        { offset: at(IMPACT), opacity: 0.95, transform: 'translate3d(0, 6px, 0) scale(1)' },
        { offset: 1, opacity: 0.85, transform: 'translate3d(0, 9px, 0) scale(1.03)' },
      ], { duration: dur, delay, fill: 'backwards', easing: 'ease-in' });
    });
    // Lichtring (ein Element) und Funken hinter der Karte, ab dem Aufprall, bis 900 ms vorbei
    const fxDur = fly - IMPACT;
    run(card.querySelector('.intro-ring'), [
      { opacity: 0.7, transform: 'translate(-50%, -50%) scale(.7)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.5)' },
    ], { duration: fxDur, delay: IMPACT, easing: 'cubic-bezier(.2, .7, .3, 1)' }); // ohne fill: vor dem Aufprall gilt die CSS-Ruhe (opacity 0)
    const r0 = Math.min(cw * (pair ? 2 : 1), ch) / 2;
    card.querySelectorAll('.intro-spark').forEach((sp, k) => {
      const ang = Math.round((k * 360) / SPARKS + (k % 2 ? 9 : -9)); // Winkel aus dem Index (kein Zufall, Lint L1)
      const off = (k * 37) % 21; // 0–20 px Versatz je Funke ⇒ ungleichmäßiger Kranz
      /** @type {HTMLElement} */ (sp).style.transform = `rotate(${ang}deg) translateX(${Math.round(r0 + off)}px)`;
    });
    // ein Behälter für alle Funken: skaliert ⇒ jeder Funke wandert ≈ 40–90 px nach außen und verblasst
    const grow = (r0 + 75) / Math.max(1, r0);
    run(card.querySelector('.intro-sparks'), [
      { opacity: 0.95, transform: 'scale(1)' },
      { opacity: 0, transform: `scale(${grow.toFixed(3)})` },
    ], { duration: fxDur, delay: IMPACT, easing: 'cubic-bezier(.15, .8, .3, 1)' });
    // Filz wackelt kurz mit (≤ 3 px)
    run(felt, [
      { transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(0, 3px, 0)', offset: 0.25 },
      { transform: 'translate3d(0, -1px, 0)', offset: 0.6 }, { transform: 'translate3d(0, 0, 0)' },
    ], { duration: fxDur, delay: IMPACT, easing: 'ease-out' });
    // Info-Tafel: ab dem Aufprall einblenden (eine Animation); Zeilen gestaffelt 40 ms über CSS (.intro-card.go), alles bis 900 ms
    run(card.querySelector('.intro-panel'), [{ opacity: 0, transform: 'translate3d(0, 10px, 0)' }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
      { duration: fly - IMPACT - 40, delay: IMPACT, easing: 'ease-out', fill: 'backwards' });
    card.classList.add('go');
  }

  /** Karte liegt (900 ms): Animationen beenden, Ring/Funken weg, will-change zurück. */
  function lie(card) {
    lieTimer = null;
    stopAnims();
    card.dataset.phase = 'lie';
    card.classList.remove('go');
    card.querySelectorAll('.intro-ring, .intro-sparks').forEach((e) => e.remove());
    card.querySelectorAll('.intro-fly').forEach((e) => { /** @type {HTMLElement} */ (e).style.willChange = 'auto'; });
    const next = idx + 1;
    setTimeout(() => prep(next), 0); // Ruhezeit: nächste Karte schon bauen
  }

  function show(k) {
    if (done) return;
    clear();
    if (k >= n) { finish(); return; }
    if (!timing) {
      timing = introTiming(pickSeconds(), still);
      root.style.setProperty('--intro-card-ms', `${timing.cardMs}ms`);
    }
    idx = k;
    const p = list[k];
    const prev = still ? /** @type {HTMLElement | null} */ (stage.querySelector('[data-intro-card]')) : null;
    mount(stage, viewOf(k));
    const card = /** @type {HTMLElement} */ (stage.querySelector('.intro-card'));
    const next = () => { timer = null; show(k + 1); };
    if (!still) card.style.visibility = 'hidden'; // bis der Anflug angelegt ist (nächster Takt), sonst blitzt die Ruhelage auf
    const size = layout(card, felt);
    paintProgress();
    live.textContent = p.deck ? fill(L.live, { i: k + 1, n, name: p.name, deck: cmdLine(p.deck) }) : fill(L.liveNoDeck, { i: k + 1, n, name: p.name });
    if (still) {
      // Weniger Bewegung: liegt sofort, Wechsel als Überblenden (Entscheid 15; nur opacity, WAAPI ⇒ unberührt von den
      // .001-ms-Regeln): die alte Karte bleibt unter der neuen liegen und blendet in derselben Zeit aus
      run(card, [{ opacity: 0 }, { opacity: 1 }], { duration: INTRO_FADE_MS, easing: 'ease-out' });
      if (prev) {
        prev.removeAttribute('data-intro-card');
        prev.setAttribute('aria-hidden', 'true');
        stage.prepend(prev);
        run(prev, [{ opacity: 1 }, { opacity: 0 }], { duration: INTRO_FADE_MS, easing: 'ease-in', fill: 'forwards' });
        fadeTimer = setTimeout(() => { fadeTimer = null; prev.remove(); }, INTRO_FADE_MS);
      }
      timer = setTimeout(next, timing.cardMs);
      return;
    }
    // Anflug in einem eigenen Takt (P8 K21): Einhängen + Maße und das Anlegen der Animationen getrennt, je kurz
    goTimer = setTimeout(() => {
      goTimer = null;
      if (done || idx !== k) return;
      animateIn(card, p, size);
      card.style.visibility = '';
      lieTimer = setTimeout(() => lie(card), timing.flyMs);
      timer = setTimeout(next, timing.cardMs);
    }, 0);
  }

  function onKey(e) {
    if (e.key !== 'Escape' || done) return;
    e.preventDefault();
    finish();
  }
  function onLeave() { finish(); }
  const mo = new MutationObserver(() => { if (!done && !root.isConnected) finish(); });

  root.addEventListener('click', (e) => {
    if (done) return;
    e.stopPropagation();
    if (/** @type {Element} */ (e.target).closest?.('[data-intro-skip]')) { finish(); return; }
    show(idx + 1); // Antippen ⇒ sofort die nächste (beim Warten: die erste), auch mitten im Anflug
  });

  if (!n) { done = true; queueMicrotask(() => { try { onDone?.(); } catch (e) { console.error(e); } }); return () => {}; }

  (host?.isConnected ? host : document.body).append(root);
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onLeave);
  root.querySelector('[data-intro-skip]')?.focus({ preventScroll: true });

  // erste Karte: alle Quellen erledigt und Bilder von Karte 1 fertig (ok/err), spätestens nach INTRO_WAIT_MS
  const opened = performance.now();
  timer = setTimeout(() => { timer = null; if (idx < 0) show(0); }, INTRO_WAIT_MS);
  all.then(async () => {
    if (done || idx >= 0) return;
    const u = urlsOf(list[0], got);
    if (u) await whenReady(u, Math.max(0, INTRO_WAIT_MS - (performance.now() - opened)));
    if (done || idx >= 0) return;
    prep(0); // Karte 1 bauen (Statistik, Kartenzeilen), Start im nächsten Takt
    setTimeout(() => { if (!done && idx < 0) show(0); }, 0);
  });

  return finish;
}
