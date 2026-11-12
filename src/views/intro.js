// Spielstart-Intro (Spec P3, Welle ttg-features): vor dem ersten Zug je Spieler eine Karte — Commander-Bild,
// Name, Deck, Deck-Bilanz, Salz, Bracket, Motto oder automatische Zeile. Stil wie die K.O.-Screens (Bühne, Abbruchwege,
// Klick-Schild), Farben nur aus Tokens (--hero, --hero-ink, --hero-mu, „Beginnt“ in --turn).
//
//   showIntro(host, { groupId, players, onDone }) ⇒ close()
//     host     Element der Spielansicht (Wurzel wird dort angehängt; fällt sie heraus ⇒ schließen)
//     groupId  Gruppe des Spiels (Deck-Bilanz und Salz aus groupData)
//     players  [{ id, seat, name, deck }] schon in Zugreihenfolge (introOrder), deck = Zeile aus g.decks oder null
//     onDone() wird genau einmal gerufen, NACH dem Abräumen (Ablauf zu Ende, Überspringen, Escape, Seitenwechsel, close())
//
// Ablauf: Laden parallel (decks select('*'), groupData, Deckliste je Deck); die erste Karte erscheint, sobald alles
// erledigt ist, spätestens nach INTRO_WAIT_MS. Jede Karte wird gebaut, wenn sie erscheint, und ändert sich danach nicht.
// Was fehlt, fällt still weg. Weiter nach INTRO_CARD_MS oder auf click (nie pointerdown); nach dem Schließen ein
// unsichtbarer Klick-Schild, damit ein Doppeltipp nie auf dem Tisch landet. Gesteuert wird nur über Zeitgeber
// (nie über animationend/transitionend); Weniger Bewegung ⇒ statische Karten, gleiche Standzeit.
import { sb } from '../supabase.js';
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
import { INTRO_CARD_MS, INTRO_WAIT_MS, recordText, saltText, cardLine, fill } from './intro-ui.js';

const SHIELD_MS = 350;
const cssUrl = (u) => `url('${String(u).replace(/'/g, '%27')}')`;

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
 * @param {string} groupId
 * @param {string[]} deckIds
 */
function loadAll(groupId, deckIds) {
  const got = { rows: null, data: null, cards: new Map() };
  const jobs = [];
  if (deckIds.length) {
    // immer select('*'): ohne Spalte motto (Datenbank vor der Migration) fehlt nur der Schlüssel, keine 400
    jobs.push(Promise.resolve().then(() => sb.from('decks').select('*').in('id', deckIds))
      .then((r) => { if (!r?.error && Array.isArray(r?.data)) got.rows = new Map(r.data.map((d) => [d.id, d])); })
      .catch(() => {}));
    for (const id of deckIds) {
      jobs.push(Promise.resolve().then(() => loadDeckCards(sb, id))
        .then((rows) => { got.cards.set(id, rows); })
        .catch(() => {}));
    }
  }
  if (groupId) {
    jobs.push(Promise.resolve().then(() => groupData.loadGroup(groupId))
      .then((data) => { got.data = data || null; })
      .catch(() => {}));
  }
  return { got, all: Promise.all(jobs) };
}

/** Karte eines Spielers aus dem, was gerade da ist. */
function cardView(p, i, got, L, lang) {
  const base = p.deck || null;
  const row = base && got.rows ? got.rows.get(base.id) || null : null;
  const deck = base ? { ...base, ...(row || {}) } : null;
  const arts = deck ? [deck.image_url, deck.partner_image_url].filter(Boolean) : [];
  const facts = [];
  let line = null;
  if (deck) {
    let dp = null;
    try { dp = got.data ? deckProfile(got.data, deck.id) : null; } catch { dp = null; }
    const rec = recordText(dp, L);
    const salt = saltText(dp, lang);
    if (rec) facts.push(html`<span class="intro-fact" data-fact="record">${icon('trophy', 16)}${rec}</span>`);
    if (salt) facts.push(html`<span class="intro-fact" data-fact="salt" title="${L.salt}">${icon('salt', 16)}<span class="sr-only">${L.salt} </span>${salt}</span>`);
    if (row && Number.isFinite(row.bracket)) facts.push(html`<span class="intro-fact" data-fact="bracket">${fill(L.bracket, { n: row.bracket })}</span>`);
    const rows = got.cards.get(deck.id);
    const traits = Array.isArray(rows) ? deckTraits(rows, deck) : null;
    // Motto nur aus der frisch geladenen Zeile (a); g.decks kennt die Spalte nicht
    line = cardLine(row ? deck : { ...deck, motto: null }, traits, L, lang);
  }
  const first = i === 0;
  const art = arts.length
    ? html`<div class="intro-art ${arts.length > 1 ? 'split' : ''}" aria-hidden="true">${arts.map((u) => html`<i class="intro-img" style="background-image:${cssUrl(u)}"></i>`)}</div>`
    : html`<div class="intro-art none" aria-hidden="true"><span class="intro-ini">${initials(p.name)}</span></div>`;
  return html`<div class="intro-card" data-intro-card="${i}" data-pid="${p.id}">
    ${art}<div class="intro-scrim" aria-hidden="true"></div>
    <div class="intro-text">
      ${first ? html`<span class="intro-first"><i aria-hidden="true"></i>${L.first}</span>` : ''}
      <h2 class="intro-name">${p.name}</h2>
      ${deck ? html`<div class="intro-deck">${manaPips(sortColors(deck.color_identity || []), 12)}<span>${cmdLine(deck)}</span></div>` : ''}
      ${facts.length ? html`<div class="intro-facts">${facts}</div>` : ''}
      ${line ? html`<p class="intro-line ${line.kind}" data-line="${line.kind}">${line.kind === 'motto' ? fill(L.motto, { text: line.text }) : line.text}</p>` : ''}
    </div>
  </div>`;
}

export function showIntro(host, { groupId, players, onDone }) {
  const L = t('intro');
  const lang = getLang();
  const list = Array.isArray(players) ? players : [];
  const n = list.length;
  const still = reducedMotion();
  let done = false;
  let idx = -1; // -1 = Bühne wartet auf die Daten
  let timer = null;

  const root = document.createElement('div');
  root.className = `intro${still ? ' intro-still' : ''}`;
  root.dataset.intro = '';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', L.label);
  mount(root, html`<div class="intro-stage" data-intro-stage></div>
    <div class="intro-top">
      <div class="intro-prog" aria-hidden="true" data-intro-prog>${list.map(() => html`<i><b></b></i>`)}</div>
      <button type="button" class="intro-skip" data-intro-skip>${L.skip}${icon('close', 16)}</button>
    </div>
    <p class="sr-only" aria-live="polite" data-intro-live></p>`);
  const stage = root.querySelector('[data-intro-stage]');
  const prog = root.querySelector('[data-intro-prog]');
  const live = root.querySelector('[data-intro-live]');

  const deckIds = [...new Set(list.map((p) => p.deck?.id).filter(Boolean))];
  const { got, all } = loadAll(groupId, deckIds);

  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
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

  function show(k) {
    if (done) return;
    clear();
    if (k >= n) { finish(); return; }
    idx = k;
    const p = list[k];
    mount(stage, cardView(p, k, got, L, lang));
    paintProgress();
    live.textContent = p.deck ? fill(L.live, { i: k + 1, n, name: p.name, deck: cmdLine(p.deck) }) : fill(L.liveNoDeck, { i: k + 1, n, name: p.name });
    timer = setTimeout(() => { timer = null; show(k + 1); }, INTRO_CARD_MS);
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
    show(idx + 1); // Antippen ⇒ sofort die nächste (beim Warten: die erste)
  });

  if (!n) { done = true; queueMicrotask(() => { try { onDone?.(); } catch (e) { console.error(e); } }); return () => {}; }

  (host?.isConnected ? host : document.body).append(root);
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onLeave);
  root.querySelector('[data-intro-skip]')?.focus({ preventScroll: true });

  // erste Karte: sobald alle Quellen erledigt sind, spätestens nach INTRO_WAIT_MS
  timer = setTimeout(() => { timer = null; if (idx < 0) show(0); }, INTRO_WAIT_MS);
  all.then(() => { if (!done && idx < 0) show(0); });

  return finish;
}
