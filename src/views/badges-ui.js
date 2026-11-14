// Bausteine der Abzeichen (P4, spec-p4-abzeichen.md „Anzeige“, „Wappen-Aussehen-Vertrag“): reine HTML-Erzeuger
// wie stats-ui.js, Node-testbar. Zustände kommen fertig aus src/lib/badges.js; hier keine Regeln.
// Wappen = Schild mit Doppelrand, Glyphe aus I (icons.js), Stufen I–III als drei Balken unten. Farben nur über
// Klassen + Tokens in src/styles/badges.css (verdient = --hi, offen = --ln, keine Spielerfarben, keine Metallfarben).
import { html, raw } from '../lib/dom.js';
import { I, icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { fmtDay } from './stats-ui.js';
import { BADGES } from '../lib/badges.js';

/** @typedef {import('../lib/badges.js').BadgeDef} BadgeDef */
/** @typedef {import('../lib/badges.js').BadgeState} BadgeState */
/** @typedef {{ memberId: string, badgeId: string, tier: 1|2|3|null, gameId?: string }} BadgeItem */
/** @typedef {((memberId: string) => string) | Record<string, string> | Map<string, string>} Who */

export const GROUPS = /** @type {const} */ (['start', 'play', 'endure', 'rare']);
export const NEW_VISIBLE = 3;
export const EVENING_VISIBLE = 6;
const ROMAN = ['', 'I', 'II', 'III'];
const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

const FACE = 'M32 2 L60 10 V34 C60 52 47 64 32 70 C17 64 4 52 4 34 V10 Z';
const INNER = 'M32 7.5 L55 14 V34 C55 49 44.5 59 32 64.5 C19.5 59 9 49 9 34 V14 Z';

/** Anzeigename (geheim + offen ⇒ „Geheim“). @param {BadgeDef} def @param {BadgeState|null|undefined} state */
export function badgeName(def, state) {
  return def.secret && !state?.earned ? t('badges.secretName') : t(`badges.list.${def.id}.name`);
}

/** Zustand als Text (aria-label, Sheet). @param {BadgeDef} def @param {BadgeState} state */
export function stateText(def, state) {
  if (def.secret && !state.earned) return t('badges.stateOpen');
  if (!def.tiers) return state.earned ? t('badges.stateEarned') : t('badges.stateOpen');
  const prog = state.next != null ? t('badges.progress', { v: state.value ?? 0, n: state.next, unit: t(`badges.unit.${def.unit}`) }) : '';
  if (state.tier > 0) return prog ? `${t('badges.stateTier', { n: state.tier })}, ${prog}` : t('badges.stateTier', { n: state.tier });
  return prog ? `${t('badges.stateOpen')}, ${prog}` : t('badges.stateOpen');
}

/**
 * Wappen (SVG, aria-hidden). Marker: `.shd.is-earned` / `.shd.is-open`, `.is-rare`, `.is-secret`.
 * @param {Partial<BadgeState>|null|undefined} state @param {BadgeDef} def @param {{ size?: number }} [opts]
 */
export function shield(state, def, { size = 56 } = {}) {
  const earned = !!state?.earned;
  const tier = Number(state?.tier) || 0;
  const hidden = def.secret && !earned;
  const w = size; const h = Math.round((size * 72) / 64);
  const cls = ['shd', earned ? 'is-earned' : 'is-open', def.rare ? 'is-rare' : '', hidden ? 'is-secret' : ''].filter(Boolean).join(' ');
  const gy = def.tiers ? 13 : 18;
  const glyph = hidden
    ? html`<text class="shd-q" x="32" y="${gy + 15}" text-anchor="middle" dominant-baseline="central">?</text>`
    : html`<svg class="shd-glyph" x="18" y="${gy}" width="28" height="28" viewBox="0 0 256 256" fill="currentColor">${raw(I[def.icon] || '')}</svg>`;
  const bars = def.tiers
    ? [0, 1, 2].map((i) => html`<rect class="shd-bar${i < tier ? ' on' : ''}" x="${19 + i * 9.5}" y="50" width="7" height="3.5" rx="1.5"/>`)
    : '';
  const glint = earned && def.rare ? html`<span class="shd-glint" aria-hidden="true"></span>` : '';
  return html`<span class="${cls}" style="width:${w}px;height:${h}px"><svg class="shd-svg" viewBox="0 0 64 72" width="${w}" height="${h}" aria-hidden="true" focusable="false"><path class="shd-face" d="${FACE}"/><path class="shd-in" d="${INNER}"/>${glyph}${bars}</svg>${glint}</span>`;
}

/** Fortschrittsbalken unter dem Schild (nur Stufen-Abzeichen mit nächster Stufe). @param {BadgeDef} def @param {BadgeState} state */
function progressBar(def, state) {
  if (!def.tiers || state.next == null) return '';
  const pct = Math.max(0, Math.min(100, Math.round(((state.value ?? 0) / state.next) * 100)));
  return html`<span class="bdg-prog" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
}

/**
 * Profil-Abschnitt „Abzeichen“ (Kopf zum Auf-/Zuklappen, vier Gruppen à Raster, Statuszeile).
 * @param {{ states: BadgeState[], name?: string, isMe?: boolean, open?: boolean, loading?: { n: number, of: number }|null, partial?: boolean, lang?: string }} p
 */
export function badgeGrid({ states, open = true, loading = null, partial = false }) {
  const byId = new Map((states || []).map((s) => [s.id, s]));
  const earned = (states || []).filter((s) => s.earned).length;
  const noGames = !(states || []).some((s) => s.earned) && (byId.get('stammgast')?.value ?? 0) === 0;
  const cell = (/** @type {BadgeDef} */ def) => {
    const s = byId.get(def.id) || { id: def.id, earned: false, tier: 0, gameId: null, at: null, tierGames: [], value: null, next: null, hidden: def.secret };
    const name = badgeName(def, s);
    return html`<button type="button" class="bdg ${s.earned ? 'is-earned' : 'is-open'}" data-badge="${def.id}" aria-label="${t('badges.ariaItem', { name, state: stateText(def, s) })}">${shield(s, def, { size: 56 })}${progressBar(def, s)}<span class="bdg-name">${name}</span></button>`;
  };
  return html`<div class="section bdg-sec">
    <button type="button" class="collapse-head" data-act="toggle-badges" aria-expanded="${open ? 'true' : 'false'}" aria-controls="prof-badges">
      <h3 class="section-title">${t('badges.title')} <span class="count">${t('badges.earnedCount', { n: earned, of: BADGES.length })}</span></h3>
      <span class="chev">${icon('chevDown', 20)}</span>
    </button>
    <div id="prof-badges" class="bdg-body" ${open ? '' : html`hidden`}>
      <p class="bdg-status tiny muted" aria-live="polite">${loading ? t('badges.loading', { n: loading.n, of: loading.of }) : ''}</p>
      ${partial ? html`<p class="bdg-note tiny muted">${t('badges.partial')}</p>` : ''}
      ${noGames ? html`<p class="bdg-note tiny muted">${t('badges.noneYet')}</p>` : ''}
      ${GROUPS.map((g) => html`<h4 class="bdg-h">${t(`badges.group.${g}`)}</h4><div class="bdg-grid">${BADGES.filter((b) => b.group === g).map(cell)}</div>`)}
    </div>
  </div>`;
}

/**
 * Inhalt des Sheets zu einem Abzeichen (großes Wappen, Name, Zustand, Regel, Stufen, Verdient am + Link).
 * @param {{ def: BadgeDef, state: BadgeState, lang?: string }} p
 */
export function badgeSheet({ def, state, lang = 'de' }) {
  const hidden = def.secret && !state.earned;
  const rule = hidden ? t('badges.secretRule') : t(`badges.list.${def.id}.rule`);
  const tiers = def.tiers
    ? html`<ul class="bdg-tiers">${def.tiers.map((n, i) => {
      const on = state.tier > i;
      return html`<li class="bdg-tier${on ? ' is-on' : ''}"><span>${t('badges.tier', { n: ROMAN[i + 1] })} · ${n} ${t(`badges.unit.${def.unit}`)}</span><span class="muted">${on ? t('badges.stateEarned') : t('badges.stateOpen')}</span></li>`;
    })}</ul>`
    : '';
  const when = state.earned && state.gameId
    ? html`<p class="bdg-when">${t('badges.earnedOn', { date: fmtDay(state.at || '', lang) })} · <a href="#/partie/${state.gameId}">${t('badges.toGame')}</a></p>`
    : '';
  return html`<div class="bdg-sheet">
    ${shield(state, def, { size: 96 })}
    <h3 class="bdg-sheet-name">${badgeName(def, state)}</h3>
    <p class="bdg-sheet-state muted">${stateText(def, state)}</p>
    <p class="bdg-rule">${rule}</p>
    ${tiers}${when}
  </div>`;
}

/** @param {Who|undefined} who @param {string} id */
const nameOf = (who, id) => (typeof who === 'function' ? who(id) : who instanceof Map ? who.get(id) : who ? who[id] : '') || '';

/** @param {BadgeItem} it @param {number} size */
function itemBody(it, size) {
  const def = /** @type {BadgeDef} */ (BY_ID.get(it.badgeId));
  const state = { earned: true, tier: it.tier || 0 };
  const label = `${t(`badges.list.${def.id}.name`)}${it.tier ? ` · ${t('badges.tier', { n: ROMAN[it.tier] })}` : ''}`;
  return { def, state, label, svg: shield(state, def, { size }) };
}

/**
 * Liste mit „und {n} weitere“ (Ergebnisseite, Rückblick).
 * @param {{ items: BadgeItem[], who?: Who, title: string, visible: number, size: number, listId: string, link: boolean, cls: string }} p
 */
function badgeList({ items, who, title, visible, size, listId, link, cls }) {
  const list = (items || []).filter((it) => BY_ID.has(it.badgeId));
  if (!list.length) return '';
  const rest = list.length - visible;
  const li = (/** @type {BadgeItem} */ it, /** @type {number} */ i) => {
    const b = itemBody(it, size);
    const inner = html`${b.svg}<span class="bdg-txt"><b>${b.label}</b><small class="muted">${nameOf(who, it.memberId)}</small></span>`;
    return html`<li class="bdg-item" ${i >= visible ? html`hidden` : ''}>${link ? html`<a class="bdg-row" href="#/profil/${it.memberId}">${inner}</a>` : html`<span class="bdg-row">${inner}</span>`}</li>`;
  };
  return html`<div class="section ${cls}">
    <h3 class="section-title">${title}</h3>
    <ul class="bdg-list" id="${listId}">${list.map(li)}</ul>
    ${rest > 0 ? html`<button type="button" class="bdg-more" data-act="badges-more" aria-expanded="false" aria-controls="${listId}" data-more="${t('badges.more', { n: rest })}" data-less="${t('badges.less')}">${t('badges.more', { n: rest })}</button>` : ''}
  </div>`;
}

/**
 * „Neues Abzeichen!“ auf der Ergebnisseite: höchstens 3 sichtbar, Einträge ohne Link.
 * @param {{ items: BadgeItem[], who?: Who, lang?: string }} p
 */
export function newBadges({ items, who }) {
  const n = (items || []).length;
  return badgeList({ items, who, title: t(n === 1 ? 'badges.newOne' : 'badges.newMany'), visible: NEW_VISIBLE, size: 40, listId: 'bdg-new-list', link: false, cls: 'bdg-new' });
}

/**
 * „Abzeichen des Abends“ im Rückblick: höchstens 6 sichtbar, jeder Eintrag Link aufs Profil.
 * @param {{ items: BadgeItem[], who?: Who, lang?: string }} p
 */
export function eveningBadges({ items, who }) {
  return badgeList({ items, who, title: t('badges.evening'), visible: EVENING_VISIBLE, size: 32, listId: 'bdg-eve-list', link: true, cls: 'bdg-eve' });
}

/**
 * Knopf „und {n} weitere“ / „weniger“ umschalten (nur im Browser aufgerufen).
 * @param {HTMLElement} btn
 */
export function toggleMore(btn) {
  const list = document.getElementById(btn.getAttribute('aria-controls') || '');
  if (!list) return;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  const visible = list.id === 'bdg-eve-list' ? EVENING_VISIBLE : NEW_VISIBLE;
  [...list.children].forEach((li, i) => { if (i >= visible) /** @type {HTMLElement} */ (li).hidden = !open; });
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.textContent = (open ? btn.dataset.less : btn.dataset.more) || '';
}
