// Setup „Neues Spiel“ (Spec P7, HANDOFF 5.3, Mockup P2 Bildschirme 1 + 2):
// Spieler 2–6, Sitzordnung mit Mini-Vorschau (zwei Plätze tauschen), Deck je Spieler
// (eigene zuerst, dann Leihdecks), Feldfarbe-Sheet, Startspieler, Startleben, Start.
// Der Entwurf liegt in sessionStorage (src/lib/setup-draft.js, je Gruppe) und übersteht den Umweg über
// „+ Spieler“ (#/spieler-neu?zurueck=setup) und „+ Commander“ (#/deck-neu/<id>?zurueck=setup).
// P7 (Welle ttg-live-feinschliff-decks): Startleben und Tischlayout kommen aus den Spiel-Standards (src/lib/prefs.js);
// der Entwurf stellt sie nur wieder her, wenn sie hier angefasst wurden (lifeSet/layoutSet). Bracket-Hinweis über dem
// Start-Knopf (bracket-hint.js), blockiert nie.
import { sb, must } from '../supabase.js';
import { state, currentMembership } from '../state.js';
import { html, mount, on, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { memberName } from '../lib/parts.js';
import { errText, sheet, toast } from '../lib/ui.js';
import { createStore } from '../lib/game-store.js';
import {
  PALETTE, PALETTE_KEYS, COLORLESS, commanderColors, fieldColors, fieldMode, modeColors, fieldBg, fieldStyle, styleText, swatchBg, frameColor,
} from '../lib/field-color.js';
import { LAYOUTS, layoutFor } from '../game/layouts.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';
import { MEMBER_SELECT } from './groups.js';
import { openDiceTable } from './dice.js';
import { bracketHint } from './bracket-hint.js';
import { getPrefs } from '../lib/prefs.js';
import { readDraft, writeDraft, clearDraft, rematchLoss } from '../lib/setup-draft.js';

const MAX = 6;
const LIVES = [20, 25, 30, 40];
const DECK_COLS = 'id, owner_profile_id, owner_member_id, short_name, commander_name, partner_name, image_url, partner_image_url, color_identity, field_color, field_mode, bracket, bracket_check, created_at';
const clampLife = (v) => Math.max(5, Math.min(99, Math.round(Number(v) || 40)));
const cssUrl = (u) => `url('${String(u).replace(/'/g, '%27')}')`;

/** Query-Teil des Hash (#/spiel-neu?deck=…&fuer=…) — der Router ignoriert ihn. */
function hashQuery() { return new URLSearchParams(location.hash.split('?')[1] || ''); }

/** Commander-Bild(er) als Ebenen, Partner geteilt. */
const artLayers = (d) => html`<div class="su-art">${[d?.image_url, d?.partner_image_url].filter(Boolean).map((u) => html`<i style="--img:${cssUrl(u)}"></i>`)}</div>`;

export default async function setup(el, { isStale }) {
  const gid = state.groupId;
  const store = createStore(sb);
  const [members, decksRaw] = await loadGroup(gid);
  if (isStale()) return;

  const me = currentMembership()?.id || null;
  const byId = new Map(members.map((m) => [m.id, m]));
  const decks = new Map(decksRaw.map((d) => [d.id, d]));
  const ownerOf = (d) => members.find((m) => (m.profile_id ? d.owner_profile_id === m.profile_id : d.owner_member_id === m.id))?.id || null;
  const ownDecks = (mid) => decksRaw.filter((d) => ownerOf(d) === mid);
  /** Eigene Decks zuerst (neueste oben), danach die Decks der anderen in Mitglieder-Reihenfolge. */
  const deckCycle = (mid) => [...ownDecks(mid), ...members.filter((m) => m.id !== mid).flatMap((m) => ownDecks(m.id))];
  const canAddDeck = (mid) => mid === me || !byId.get(mid)?.profile_id;
  const name = (mid) => memberName(byId.get(mid) || {}) || '?';

  // ---------- Zustand (Entwurf wiederherstellen, Rückkehr vom Umweg einarbeiten)
  // roll = letzter übernommener Startwurf (P9) { key: Sitzbelegung, startRoll } ⇒ roll-Ereignis beim Start
  // Standards je Gerät (P7); layoutFor() fällt beim Start auf ein passendes Layout zurück, wenn es zur Spielerzahl nicht passt
  const std = getPrefs();
  const s = { sel: [], deck: {}, layout: std.layout, life: std.startLife, layoutSet: false, lifeSet: false, start: null, roll: null, swap: null, starting: false, error: '' };
  const draft = readDraft(gid);
  if (draft) {
    s.sel = (Array.isArray(draft.sel) ? draft.sel : []).filter((id, i, a) => byId.has(id) && a.indexOf(id) === i).slice(0, MAX);
    for (const id of s.sel) s.deck[id] = decks.has(draft.deck?.[id]) ? draft.deck[id] : (ownDecks(id)[0]?.id || null);
    // Nur hier angefasste Werte gehen dem Standard vor (sonst wirkt eine neue Einstellung erst mit neuem Tab)
    if (draft.layoutSet === true && LAYOUTS.includes(draft.layout)) { s.layout = draft.layout; s.layoutSet = true; }
    if (draft.lifeSet === true && Number.isInteger(draft.life) && draft.life >= 5 && draft.life <= 99) { s.life = draft.life; s.lifeSet = true; } // ungültig ⇒ Standard
    s.start = Number.isInteger(draft.start) && draft.start < s.sel.length ? draft.start : null;
    // Wurf übersteht Umweg und Neuladen, aber nur passend zu Sitzbelegung und Startspieler (sonst verfallen)
    const r = draft.roll, v = r?.startRoll?.values;
    if (r && r.key === s.sel.join() && r.startRoll.winnerSeat === s.start && Array.isArray(v) && v.length === s.sel.length
      && v.every((x) => Number.isInteger(x) && x >= 1 && x <= 6)) s.roll = { key: r.key, startRoll: { values: v, winnerSeat: s.start } };
  }
  // P2 Revanche: was beim Wiederherstellen herausfiel (Spieler entfernt, Deck nicht mehr verfügbar) ⇒ ein Hinweis nach
  // dem ersten Zeichnen. Die Marke `rematch` verschwindet mit dem ersten save() ⇒ Neuladen/Umweg zeigen ihn nicht erneut.
  const loss = rematchLoss(draft, s);
  if (!s.sel.length && me && byId.has(me)) { // kein oder abgelaufener Entwurf ⇒ eigenes Mitglied vorausgewählt
    s.sel = [me];
    s.deck[me] = ownDecks(me)[0]?.id || null;
  }
  const q = hashQuery();
  const newPlayer = q.get('spieler');
  if (newPlayer && byId.has(newPlayer) && !s.sel.includes(newPlayer) && s.sel.length < MAX) {
    s.sel.push(newPlayer); s.deck[newPlayer] = ownDecks(newPlayer)[0]?.id || null; s.start = null;
  }
  const newDeck = q.get('deck'), forMember = q.get('fuer');
  if (newDeck && decks.has(newDeck) && forMember && byId.has(forMember)) {
    if (!s.sel.includes(forMember) && s.sel.length < MAX) { s.sel.push(forMember); s.start = null; }
    if (s.sel.includes(forMember)) s.deck[forMember] = newDeck;
  }
  if (q.toString()) history.replaceState(null, '', '#/spiel-neu'); // Neu-Laden fügt nichts doppelt hinzu
  const save = () => writeDraft(gid, s);
  save();

  // ---------- Ansicht
  function reason() {
    if (s.sel.length < 2) return t('setup.needTwo');
    const missing = s.sel.filter((id) => !s.deck[id]);
    if (missing.length === 1) return t('setup.needDeck', { name: name(missing[0]) });
    if (missing.length > 1) return t('setup.needDecks', { n: missing.length });
    return '';
  }
  const firstSeat = () => (s.start != null && s.start < s.sel.length ? s.start : 0);

  function chipsHtml() {
    return html`<div class="su-chips">${members.map((m) => {
      const on = s.sel.includes(m.id);
      const full = !on && s.sel.length >= MAX;
      return html`<button type="button" class="su-pill" data-act="member" data-id="${m.id}" aria-pressed="${String(on)}" ${full ? html`aria-disabled="true"` : ''}>${on ? icon('check', 16) : ''}<span>${memberName(m)}</span>${m.profile_id ? '' : html`<small>${t('setup.guest')}</small>`}</button>`;
    })}<a class="su-pill dash" href="#/spieler-neu?zurueck=setup" data-act="detour">${icon('plus', 16)}<span>${t('setup.addPlayer')}</span></a></div>`;
  }

  function seatsHtml() {
    const n = s.sel.length;
    if (!n) return '';
    const L = layoutFor(n, s.layout);
    const rot = (r) => (r === 90 || r === -90 || r === 180 ? `transform:rotate(${r}deg)` : '');
    const cells = s.sel.map((id, i) => {
      const sl = L.slots[i]; const d = decks.get(s.deck[id]);
      const art = d?.image_url ? `--img:${cssUrl(d.image_url)};` : '';
      return html`<button type="button" data-act="swap" data-i="${i}" aria-pressed="${String(s.swap === i)}" aria-label="${t('setup.seat', { n: i + 1, name: name(id) })}"
        class="${d?.image_url ? '' : 'nodeck'}" style="grid-column:${sl.c} / span ${sl.cs};grid-row:${sl.r} / span ${sl.rs};${art}">
        <span class="lab" style="${rot(sl.rot)}"><small>${i + 1}</small><b>${name(id)}</b></span></button>`;
    });
    const desc = t(`setup.layoutDesc.${s.layout}`);
    const two = n === 2 && L.layout !== s.layout;
    return html`<div class="su-seatmap">
      <div class="su-mini" style="grid-template-columns:repeat(${L.cols},minmax(0,1fr));grid-template-rows:repeat(${L.rows},minmax(0,1fr))">${cells}</div>
      <p>${desc}${two ? html`<br><br>${t('setup.twoAuto')}` : ''}</p></div>`;
  }

  function swatchHtml(d) {
    const mode = fieldMode(d);
    if (mode === 'art' && d.image_url) return html`<span class="su-swatch art" style="--img:${cssUrl(d.image_url)}"></span>`;
    const cols = modeColors(d);
    return html`<span class="su-swatch" style="background:${swatchBg(cols)};--ring:${frameColor(cols[0])}"></span>`;
  }

  function rowHtml(id, i) {
    const d = decks.get(s.deck[id]);
    const startsHere = s.sel.length >= 2 && i === firstSeat();
    let deckUi;
    if (d) {
      deckUi = html`<button type="button" class="su-swatch-btn" data-act="color" data-mid="${id}" aria-label="${t('setup.colorFor', { name: name(id) })}">${swatchHtml(d)}</button>
        <button type="button" class="su-deckbtn" data-act="cycle" data-mid="${id}" aria-label="${t('setup.changeDeck', { name: name(id) })}">
          <span class="thumb" style="${d.image_url ? `--img:${cssUrl(d.image_url)}` : ''}"></span>
          <span class="t"><span>${d.short_name || d.commander_name}</span><span class="pips">${d.color_identity?.length
            ? d.color_identity.map((c) => html`<i class="pip ${c}"></i>`) : html`<i class="pip" style="background:${COLORLESS}"></i>`}</span></span>
          ${icon('chevDown', 16)}</button>`;
    } else {
      const canBorrow = deckCycle(id).length > 0;
      deckUi = html`${canAddDeck(id)
        ? html`<a class="su-addcmd" href="#/deck-neu/${id}?zurueck=setup" data-act="detour">${icon('plus', 16)}${t('setup.commander')}</a>`
        : html`<span class="su-nodeck">${t('setup.noDeckYet')}</span>`}
        ${canBorrow ? html`<button type="button" class="su-borrow" data-act="cycle" data-mid="${id}" aria-label="${t('setup.borrow')}" title="${t('setup.borrow')}">${icon('arrowsLeftRight', 18)}</button>` : ''}`;
    }
    return html`<div class="su-row" data-mid="${id}"><span class="seat">${i + 1}</span>
      <span class="who"><b>${name(id)}</b>${startsHere ? html`<small>${icon('diceFive', 13)}${t('setup.starts')}</small>` : ''}</span>${deckUi}</div>`;
  }

  function view() {
    const n = s.sel.length;
    const why = reason();
    const noDecks = decksRaw.length === 0;
    const hint = s.life === 40 ? t('setup.lifeHint.std') : s.life < 40 ? t('setup.lifeHint.fast') : t('setup.lifeHint.long');
    const swapHint = s.swap == null ? t('setup.swapHint') : t('setup.swapPicked', { name: name(s.sel[s.swap]) });
    const starter = n ? (s.start == null ? t('setup.notRolled') : t('setup.startsName', { name: name(s.sel[firstSeat()]) })) : '–';
    const starterSub = n && s.start == null ? t('setup.startsDefault', { name: name(s.sel[firstSeat()]) }) : '';
    return html`<div class="su">
      <div class="head"><a class="icon-btn" href="#/start" aria-label="${t('common.back')}">${icon('back', 20)}</a><h2 class="su-title">${t('setup.title')}</h2></div>

      <section class="su-sec"><div class="su-sec-head"><span class="su-eyebrow">${t('setup.who')}</span><span class="su-mu num">${t('setup.count', { n })}</span></div>
        ${chipsHtml()}
        ${members.length < 2 ? html`<p class="su-note">${icon('warn', 16)}<span>${t('setup.onlyOne')}</span></p>` : ''}</section>

      <section class="su-sec"><div class="su-sec-head"><span class="su-eyebrow">${t('setup.seats')}</span><span class="su-mu">${n >= 2 ? swapHint : ''}</span></div>
        <div class="su-layouts">${LAYOUTS.map((k) => html`<button type="button" class="su-pill" data-act="layout" data-l="${k}" aria-pressed="${String(s.layout === k)}">${t(`setup.layouts.${k}`)}</button>`)}</div>
        ${seatsHtml()}</section>

      <section class="su-sec"><span class="su-eyebrow">${t('setup.decks')}</span>
        ${noDecks ? html`<div class="su-empty">${icon('palette', 20)}<span>${t('setup.noDecks')}</span></div>` : ''}
        ${n ? html`<div class="su-decks">${s.sel.map(rowHtml)}</div>` : ''}
        <span class="su-mu su-small">${t('setup.decksHint')}</span></section>

      <div class="su-card su-startrow">${icon('diceFive', 30)}<span class="grow"><span class="su-eyebrow">${t('setup.starter')}</span><b>${starter}</b>${starterSub ? html`<span class="su-mu su-small" data-starter>${starterSub}</span>` : ''}</span>
        <button type="button" class="btn small" data-act="roll" ${n < 2 ? 'disabled' : ''}>${t('setup.roll')}</button></div>

      <div class="su-card"><div class="su-liferow"><span class="grow"><span class="su-eyebrow">${t('setup.life')}</span><span class="su-mu su-small">${hint}</span></span>
        <div class="su-stepper"><button type="button" data-act="life" data-v="-5" aria-label="${t('setup.lifeLess')}">${icon('minus', 18)}</button>
          <span class="su-lifebig num" aria-live="polite">${s.life}</span>
          <button type="button" data-act="life" data-v="5" aria-label="${t('setup.lifeMore')}">${icon('plus', 18)}</button></div></div>
        <div class="su-chips4">${LIVES.map((v) => html`<button type="button" class="su-pill" data-act="lifeset" data-v="${v}" aria-pressed="${String(s.life === v)}">${v}</button>`)}</div></div>

      <div class="su-sec su-go">${hintHtml()}<button type="button" class="btn block" data-act="start" ${why || s.starting ? 'disabled' : ''} ${s.starting ? html`aria-busy="true"` : ''}>${t('setup.start')}</button>
        ${why ? html`<span class="su-why" data-why>${icon('warn', 16)}${why}</span>` : ''}
        ${s.error ? html`<p class="error" role="alert">${s.error}</p>` : ''}</div>
    </div>`;
  }

  /** Bracket-Hinweis (P7): unaufdringlich über dem Start-Knopf, nur bei ≥ 2 Stufen bzw. höher geprüftem Deck. */
  function hintHtml() {
    const list = s.sel.map((id) => decks.get(s.deck[id]) || null);
    const hints = bracketHint(list);
    if (!hints) return '';
    const lines = hints.map((h) => (h.kind === 'spread'
      ? t('table.hint.spread', { min: h.min, max: h.max })
      : t('table.hint.check', { deck: list[h.deck]?.short_name || list[h.deck]?.commander_name || '?', n: h.floor })));
    return html`<p class="tb-hint" data-bracket-hint role="note">${icon('shieldStar', 16)}<span>${lines.map((l) => html`<span>${l}</span>`)}</span></p>`;
  }

  const render = () => { if (el.isConnected) mount(el, view()); };

  // ---------- Aktionen
  on(el, 'click', '[data-act]', async (e, b) => {
    const act = b.dataset.act;
    if (act === 'detour') { save(); return; } // Link folgt; Entwurf ist gespeichert
    if (act === 'member') {
      const id = b.dataset.id; const i = s.sel.indexOf(id);
      if (i >= 0) { s.sel.splice(i, 1); delete s.deck[id]; }
      else if (s.sel.length >= MAX) { toast(t('setup.max')); return; }
      else { s.sel.push(id); s.deck[id] = ownDecks(id)[0]?.id || null; }
      s.swap = null; s.start = null;
    } else if (act === 'layout') { s.layout = b.dataset.l; s.layoutSet = true; s.swap = null; }
    else if (act === 'swap') {
      const i = +b.dataset.i;
      if (s.swap == null) s.swap = i;
      else if (s.swap === i) s.swap = null;
      else { [s.sel[s.swap], s.sel[i]] = [s.sel[i], s.sel[s.swap]]; s.swap = null; s.start = null; }
    } else if (act === 'cycle') {
      const id = b.dataset.mid; const list = deckCycle(id);
      if (!list.length) return;
      const at = list.findIndex((d) => d.id === s.deck[id]);
      s.deck[id] = list[(at + 1) % list.length].id;
    } else if (act === 'life') { s.life = clampLife(s.life + Number(b.dataset.v)); s.lifeSet = true; }
    else if (act === 'lifeset') { s.life = clampLife(b.dataset.v); s.lifeSet = true; }
    else if (act === 'roll') {
      if (s.sel.length < 2) return;
      const sel = s.sel.slice(); // Würfeltisch (P9); Schließen ohne Übernehmen ändert nichts
      openDiceTable(document.body, { players: sel.map((id, seat) => ({ seat, name: name(id) })), onAccept: ({ winnerSeat, values }) => {
        if (!el.isConnected || s.sel.join() !== sel.join()) return;
        s.start = winnerSeat; s.roll = { key: sel.join(), startRoll: { values, winnerSeat } };
        s.error = ''; save(); render();
      } });
      return;
    } else if (act === 'color') { openColor(b.dataset.mid); return; }
    else if (act === 'start') { await start(); return; }
    s.error = '';
    save(); render();
  });

  async function start() {
    if (s.starting || reason()) return;
    s.starting = true; s.error = ''; render();
    try {
      const n = s.sel.length;
      const gameId = await store.startGame({
        groupId: gid,
        layout: layoutFor(n, s.layout).layout,
        startingLife: s.life,
        firstSeat: firstSeat(),
        startRoll: s.roll && s.roll.key === s.sel.join() && s.roll.startRoll.winnerSeat === s.start ? s.roll.startRoll : null,
        players: s.sel.map((id, seat) => ({ memberId: id, deckId: s.deck[id], seat })),
      });
      clearDraft(gid);
      go(`/spiel/${gameId}`, { replace: true });
    } catch (ex) {
      s.starting = false; s.error = errText(ex); render();
    }
  }

  // ---------- Feldfarbe-Sheet (gemeinsam mit dem Lifecounter, siehe openFieldColor unten)
  function openColor(mid) {
    const d = decks.get(s.deck[mid]);
    if (!d) return;
    openFieldColor(d, render, { name: name(mid), life: s.life, store });
  }

  render();
  if (loss && (loss.players > 0 || loss.decks > 0)) {
    const n = (k, c) => (c === 1 ? t(`setup.rematch.${k}1`) : t(`setup.rematch.${k}N`, { n: c }));
    toast([t('setup.rematch.lead'), loss.players > 0 ? n('players', loss.players) : '', loss.decks > 0 ? n('decks', loss.decks) : ''].filter(Boolean).join(' '));
  }
}

/**
 * Feldfarbe-Sheet (HANDOFF 5.4a, WELLE E2 F1: Commander-Bild · Commander-Farben · eigene Farbe).
 * Setup und Lifecounter (P8) teilen es. `deck` wird sofort angepasst (optimistisch) und per
 * store.setFieldColor gespeichert; scheitert das, wird zurückgedreht. `onChange()` nach jeder
 * Änderung (auch beim Zurückdrehen). opts: name/life für Untertitel und Vorschau.
 */
export function openFieldColor(d, onChange, { name = '', life = 40, store = createStore(sb) } = {}) {
  if (!d) return;
  let chain = Promise.resolve();
  const look = document.documentElement.dataset.theme || 'nacht';
  const body = () => {
    const mode = fieldMode(d);
    const own = mode === 'color' ? d.field_color : null;
    const st = fieldStyle(mode === 'color' ? fieldColors(d) : commanderColors(d), look, mode);
    const cmdCols = commanderColors(d);
    const manaNames = (d.color_identity?.length ? d.color_identity : ['C']).map((c) => t(`setup.mana.${c}`)).join(', ');
    return html`<div class="su-sh-head"><span class="t"><h3>${t('setup.field.title')}</h3><small>${t('setup.field.sub', { name, deck: d.short_name || d.commander_name })}</small></span>
        <button type="button" class="btn small" data-act="done">${t('setup.field.done')}</button></div>
      <div class="su-preview" style="${styleText(st)}">${artLayers(d)}<div class="su-tint"></div><div class="su-scrim"></div>
        <div class="pv"><b>${name}</b><span class="n num">${life}</span></div></div>
      <button type="button" class="su-opt" data-mode="art" aria-pressed="${String(mode === 'art')}"><span class="sw art" style="${d.image_url ? `--img:${cssUrl(d.image_url)}` : ''}"></span>
        <span class="grow"><b>${t('setup.field.art')}</b><small>${t('setup.field.artSub')}</small></span>${mode === 'art' ? icon('check', 20) : ''}</button>
      <button type="button" class="su-opt" data-mode="commander" aria-pressed="${String(mode === 'commander')}"><span class="sw" style="background:${fieldBg(cmdCols, 100)}"></span>
        <span class="grow"><b>${t('setup.field.commander')}</b><small>${manaNames}</small></span>${mode === 'commander' ? icon('check', 20) : ''}</button>
      <span class="su-eyebrow">${t('setup.field.own')}</span>
      <div class="su-palette">${PALETTE.map((c, i) => html`<button type="button" data-mode="color" data-c="${c}" aria-pressed="${String(own === c)}" aria-label="${t(`setup.colors.${PALETTE_KEYS[i]}`)}">
        <i style="background:${c}">${own === c ? icon('check', 20) : ''}</i>${t(`setup.colors.${PALETTE_KEYS[i]}`)}</button>`)}</div>`;
  };
  sheet(t('setup.field.title'), html`<div class="su-sheet">${body()}</div>`, (sh, close) => {
    const box = $('.su-sheet', sh);
    const paint = () => { mount(box, body()); onChange(); };
    sh.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="done"]')) { close(); return; }
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      const mode = b.dataset.mode; const color = mode === 'color' ? b.dataset.c : null;
      if (fieldMode(d) === mode && (mode !== 'color' || d.field_color === color)) return;
      const before = { field_mode: d.field_mode, field_color: d.field_color };
      Object.assign(d, { field_mode: mode, field_color: color });
      paint(); // sofort sichtbar
      chain = chain.then(() => store.setFieldColor(d.id, mode, color)).catch((ex) => {
        Object.assign(d, before);
        if (box.isConnected) paint(); else onChange();
        toast(`${t('setup.field.saveFailed')} ${errText(ex)}`);
      });
    });
  });
}

/** Mitglieder (inkl. Profilnamen) und alle nicht archivierten Decks der Gruppe. */
async function loadGroup(gid) {
  // P10: nur aktive Mitglieder (Filter im Client, Übergangsregel H) ⇒ Entfernte fallen auch aus Entwurf und ?spieler=
  const members = (await sb.from('members').select(MEMBER_SELECT).eq('playgroup_id', gid).order('created_at').then(must))
    .filter((m) => !m.removed_at);
  const pids = members.filter((m) => m.profile_id).map((m) => m.profile_id);
  const mids = members.filter((m) => !m.profile_id).map((m) => m.id);
  const ors = [];
  if (pids.length) ors.push(`owner_profile_id.in.(${pids.join(',')})`);
  if (mids.length) ors.push(`owner_member_id.in.(${mids.join(',')})`);
  const decks = ors.length
    ? await sb.from('decks').select(DECK_COLS).eq('archived', false).or(ors.join(',')).order('created_at', { ascending: false }).then(must)
    : [];
  return [members, decks.filter((d) => !d.archived)]; // archivierte nie (Server filtert schon; doppelt hält)
}
