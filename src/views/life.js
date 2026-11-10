// Lifecounter (Spec P8, HANDOFF 5.4, Mockup P2 Bildschirme 3–5): Felder je Sitz (Layout + Drehung
// aus layouts.js), Tippen links −1 / rechts +1, Zug beenden, Spielmenü (Zug · Werkzeuge · Verlauf),
// Zähler-Sheet, Randomizer, einfacher Ausscheide-Ablauf (ko.js), Spiel beenden (E4).
// Alle Regeln kommen aus der Engine (P3), alle Schreibvorgänge über den Store (P5):
// Aktion ⇒ act() ⇒ recorder.push(events) + store.publish(state) ⇒ Felder neu zeichnen.
// Render-Strategie: das Brett wird nur bei Layout-/Farbwechsel neu aufgebaut; jede Aktion
// aktualisiert gezielt die Teile der Felder (Zahl, Abzeichen, Knöpfe), die Tippzonen bleiben stehen.
import { sb, must } from '../supabase.js';
import { state as app } from '../state.js';
import { html, mount, on, $, $$, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { empty, memberName } from '../lib/parts.js';
import { errText, sheet, toast } from '../lib/ui.js';
import { createStore } from '../lib/game-store.js';
import { appRand } from '../lib/rand.js';
import { fieldMode, modeColors, fieldStyle, styleText } from '../lib/field-color.js';
import { act, isLethal, newlyLethal, canUndo, history, killerCandidates, results, COUNTER_MAX, POISON_MAX } from '../game/engine.js';
import { LAYOUTS, layoutFor } from '../game/layouts.js';
import { roll } from '../game/rng.js';
import { koPick } from '../game/ko.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';
import { MEMBER_SELECT } from './groups.js';
import { openFieldColor } from './setup.js';
import { showKo } from './ko.js';
import { attachAttack } from './attack.js';
import {
  mmss, signed, counterRows, togglePin, DEFAULT_PINS, rollText, logText, lowLife, cmdLine, shortCmd, byPlace, flickerValue, secondsSince,
} from './life-ui.js';

// Ein Store für alle Besuche: die Schreib-Warteschlange je Spiel (Timer, online-Ereignis) lebt
// über Seitenwechsel weiter und wird nicht doppelt angelegt.
const store = createStore(sb);

const DELTA_MS = 1800;
const FLICKER_MS = 500;
const ROLL_KINDS = ['w6', 'w6x2', 'w20', 'coin', 'player'];
const CTR_ICON = { poison: 'drop', tax: 'coins', tax2: 'coins', energy: 'lightning', exp: 'star', rad: 'radioactive', speed: 'gauge', ring: 'eye', dungeon: 'castleTurret' };
const FLAGS = [['monarch', 'crown'], ['init', 'shieldStar'], ['city', 'buildings']];
const MAX = { poison: POISON_MAX, ...COUNTER_MAX };

const cssUrl = (u) => `url('${String(u).replace(/'/g, '%27')}')`;
const layoutKey = (id) => `ttg.layout.${id}`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* Privatmodus */ } };
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Drehung ±90° per Container-Einheiten, 180° per transform (Mockup innerStyle). */
const innerStyle = (rot) => (rot === 90 || rot === -90
  ? `position:absolute;top:50%;left:50%;width:100cqh;height:100cqw;transform:translate(-50%,-50%) rotate(${rot}deg)`
  : `position:absolute;inset:0;${rot === 180 ? 'transform:rotate(180deg)' : ''}`);

/** Ruft fn auf, sobald das Sheet (gleich wie: Knopf, Hintergrund, Escape, Seitenwechsel) weg ist. */
function watchClose(sh, fn) {
  const wrap = sh.closest('.sheet-wrap');
  const mo = new MutationObserver(() => { if (!wrap.isConnected) { mo.disconnect(); fn(); } });
  mo.observe(document.body, { childList: true });
}

/** Ungesendete Warteschlangen anderer Spiele (Etappe 3: ein Gerät je Spiel). */
function otherQueues(id) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ttg.queue.') && k !== `ttg.queue.${id}`) out.push(k.slice('ttg.queue.'.length));
    }
  } catch { /* gesperrt */ }
  return out;
}

export default async function life(el, { params, isStale }) {
  const id = params.id;
  const back = html`<div class="head"><a class="icon-btn" href="#/start" aria-label="${t('common.back')}">${icon('back', 20)}</a></div>`;
  let g;
  try { g = await store.loadGame(id); } catch (ex) {
    if (!isStale()) mount(el, html`${back}${empty('warn', t('common.error'), errText(ex))}`);
    return;
  }
  // Anzeigenamen wie überall in der App (Profilname bei Konten), nicht members.display_name
  let names = new Map();
  try {
    const ms = await sb.from('members').select(MEMBER_SELECT).in('id', g.players.map((p) => p.member_id)).then(must);
    names = new Map(ms.map((m) => [m.id, memberName(m)]));
  } catch { /* Rückfall auf die Namen aus loadGame */ }
  if (isStale()) return;

  if (g.game.status !== 'live') {
    mount(el, html`${back}${empty('flag', t('life.ended'), t('life.endedSub'))}<a class="btn block" href="#/start">${t('life.toStart')}</a>`);
    return;
  }

  // ---------- Grunddaten
  const rec = store.recorder(id);
  const actor = app.memberships.find((m) => m.playgroup_id === g.game.playgroup_id)?.id ?? null;
  const startedAt = Date.parse(g.game.started_at) || Date.now();
  const look = document.documentElement.dataset.theme || 'nacht';
  const gp = new Map(g.players.map((p) => [p.member_id, p]));
  const nm = (mid) => names.get(mid) || gp.get(mid)?.name || '?';
  const deckOf = (mid) => g.decks[gp.get(mid)?.deck_id] || null;
  let s = g.state;
  const pl = (mid) => s.players.find((p) => p.id === mid);
  const bySeat = (seat) => s.players.find((p) => p.seat === seat);
  let layout = lsGet(layoutKey(id));
  if (!LAYOUTS.includes(layout)) layout = g.game.layout;

  const others = otherQueues(id);
  if (others.length) { for (const o of others) store.recorder(o); toast(t('life.otherQueue')); }
  store.publish(id, s); // Anzeigetafel hat sofort einen Stand

  // ---------- Laufzeit-Zustand der Ansicht
  const deltas = new Map(); // member_id ⇒ { v, timer }
  const koQueue = [];
  let koOpen = false;
  let endShown = s.finished;
  let menu = null; // offenes Spielmenü { repaint, live, close }
  let ctrSheet = null; // offenes Zähler-Sheet { repaint, close }
  let stopped = false;
  const timers = new Set();

  // ---------- Felder
  function fieldHtml(p, sl) {
    const d = deckOf(p.id);
    const st = d ? styleText(fieldStyle(modeColors(d), look, fieldMode(d))) : '';
    const arts = [d?.image_url, d?.partner_image_url].filter(Boolean);
    return html`<div class="lc-field" data-pid="${p.id}" style="grid-column:${sl.c} / span ${sl.cs};grid-row:${sl.r} / span ${sl.rs};${st}">
      <div class="lc-inner" style="${innerStyle(sl.rot)}">
        <div class="lc-art">${arts.map((u) => html`<i style="--img:${cssUrl(u)}"></i>`)}</div><div class="lc-tint"></div><div class="lc-scrim"></div>
        <div class="lc-top"><span class="who"><b>${nm(p.id)}</b><span>${cmdLine(d)}</span></span>
          <span class="lc-stat"><span class="lc-badges" data-part="badges"></span>
            <button type="button" class="lc-more" data-act="counters" data-pid="${p.id}" aria-label="${t('life.moreFor', { name: nm(p.id) })}">${icon('dotsThree', 24)}</button></span></div>
        <div class="lc-mid">
          <button type="button" class="lc-tap minus" data-act="tap" data-pid="${p.id}" data-v="-1" aria-label="${t('life.lifeLess', { name: nm(p.id) })}">${icon('minus', 26)}</button>
          <button type="button" class="lc-tap plus" data-act="tap" data-pid="${p.id}" data-v="1" aria-label="${t('life.lifeMore', { name: nm(p.id) })}">${icon('plus', 26)}</button>
          <div class="lc-num" data-part="num"></div>
        </div>
        <div class="lc-bot" data-part="bot"></div>
        <div class="lc-plaque" data-part="plaque"></div>
      </div></div>`;
  }

  function paintField(p) {
    const f = $(`.lc-field[data-pid="${p.id}"]`, el);
    if (!f) return;
    const turn = !s.finished && !p.out && p.seat === s.turn;
    const lethal = isLethal(p);
    const winner = s.finished && !p.out && p.place === 1;
    f.classList.toggle('turn', turn);
    f.classList.toggle('out', p.out);
    f.classList.toggle('lethal', lethal);
    const cmdMax = Object.values(p.cmd).reduce((m, v) => Math.max(m, v), 0);
    mount($('[data-part="badges"]', f), html`${p.poison > 0 ? html`<span class="lc-badge" title="${t('life.counters.labels.poison')}">${icon('drop', 14)}${p.poison}</span>` : ''}${cmdMax > 0 ? html`<span class="lc-badge">${icon('sword', 14)}${cmdMax}</span>` : ''}${FLAGS.filter(([k]) => p[k]).map(([k, ic]) => html`<span class="lc-badge ${k}" title="${t(`life.counters.flags.${k}`)}">${icon(ic, 15)}</span>`)}`);
    const dl = deltas.get(p.id);
    mount($('[data-part="num"]', f), html`${dl && dl.v ? html`<span class="lc-delta ${dl.v < 0 ? 'neg' : 'pos'}">${signed(dl.v)}</span>` : ''}
      <span class="lc-big ${lowLife(p) ? 'low' : ''}" data-life>${p.life}</span>
      ${turn && !lethal ? html`<span class="lc-turnchip"><i></i>${t('life.turn')} · <span data-clock="turn">${mmss(secondsSince(s.turnStartedAt, Date.now()))}</span></span>` : ''}`);
    mount($('[data-part="bot"]', f), lethal && !s.finished
      ? html`<button type="button" class="lc-outq" data-act="ko" data-pid="${p.id}">${icon('skull', 16)}${t('life.outQ')}</button>`
      : turn ? html`<button type="button" class="lc-endturn" data-act="endturn">${t('life.endTurn')}${icon('chevRight', 16)}</button>` : '');
    mount($('[data-part="plaque"]', f), p.out
      ? html`<div>${icon('skull', 22)}<b>${t('life.place', { n: p.place })}</b><span>${p.outBy ? t('life.outLine', { r: p.outRound, by: nm(p.outBy) }) : t('life.outLineGaveUp', { r: p.outRound })}</span></div>`
      : winner ? html`<div class="win">${icon('crown', 22)}<b>${t('life.place', { n: 1 })}</b><span>${t('life.winner')}</span></div>` : '');
  }

  function paint() {
    for (const p of s.players) paintField(p);
    const hub = $('.lc-hub', el);
    if (hub) { hub.setAttribute('aria-label', t('life.hub', { n: s.round })); $('[data-round]', hub).textContent = String(s.round); }
  }

  function boardHtml() {
    const n = s.players.length;
    const L = layoutFor(n, layout);
    const hubTop = L.layout === 'rundum' && n >= 3 ? `${(100 / L.rows).toFixed(3)}%` : '50%';
    return html`<div class="lc-board" data-layout="${L.layout}" style="grid-template-columns:repeat(${L.cols},minmax(0,1fr));grid-template-rows:repeat(${L.rows},minmax(0,1fr))">
      ${s.players.map((p, i) => fieldHtml(p, L.slots[i]))}
      <button type="button" class="lc-hub" data-act="menu" data-pid="__all" style="top:${hubTop}" aria-label="${t('life.hub', { n: s.round })}"><small>${t('life.round')}</small><b class="num" data-round>${s.round}</b></button>
    </div>`;
  }

  /** Namen unter dem Mittelknopf rücken in Feldrichtung ein (Mockup clearHub, gilt für jede Drehung). */
  function clearHub() {
    const hub = $('.lc-hub', el);
    if (!hub) return;
    const H = hub.getBoundingClientRect(); const pad = 8;
    for (const top of $$('.lc-top', el)) {
      top.style.paddingTop = ''; top.style.paddingLeft = '';
      const narrow = top.offsetWidth < 175;
      top.classList.toggle('narrow', narrow);
      const w = $('.who', top).getBoundingClientRect();
      const hit = w.left < H.right + pad && w.right > H.left - pad && w.top < H.bottom + pad && w.bottom > H.top - pad;
      if (hit) { if (narrow) top.style.paddingTop = '40px'; else top.style.paddingLeft = '62px'; }
    }
  }

  function renderBoard() {
    const box = $('.lc', el);
    if (!box) return;
    mount(box, boardHtml());
    paint();
    clearHub();
  }

  // ---------- Aktionen
  function bumpDelta(mid, d) {
    const cur = deltas.get(mid);
    if (cur) { clearTimeout(cur.timer); timers.delete(cur.timer); }
    const entry = { v: (cur?.v || 0) + d, timer: null };
    entry.timer = setTimeout(() => {
      timers.delete(entry.timer);
      if (deltas.get(mid) === entry) deltas.delete(mid);
      const p = pl(mid); if (p && !stopped) paintField(p);
    }, DELTA_MS);
    timers.add(entry.timer);
    deltas.set(mid, entry);
  }

  /** Quelle des tödlichen Ereignisses (Angriff), Tippen hat keine (HANDOFF 5.4). */
  const sourceOf = (events, mid) => events.find((e) => e.target === mid && e.source != null && e.source !== mid)?.source ?? null;

  function doAct(action) {
    if (stopped) return false;
    const prev = s;
    let r;
    try { r = act(s, action, { actor }); } catch (ex) { console.error(ex); toast(errText(ex)); return false; }
    if (!r.events.length) return false;
    s = r.state;
    rec.push(r.events);
    store.publish(id, s);
    if (action.type === 'life') bumpDelta(action.target, action.d);
    if (action.type === 'undo') { for (const dl of deltas.values()) clearTimeout(dl.timer); deltas.clear(); }
    paint();
    // Nach Rückgängig kein neuer K.O.-Ablauf: das Feld zeigt „Ausgeschieden?“, Antippen öffnet ihn
    if (action.type !== 'undo') for (const mid of newlyLethal(prev, s)) koQueue.push({ mid, by: sourceOf(r.events, mid), force: false });
    nextKo();
    return true;
  }

  function closeSheets() { menu?.close(); ctrSheet?.close(); }

  function nextKo() {
    if (koOpen || stopped) return;
    while (koQueue.length) {
      const { mid, by, force } = koQueue.shift();
      const p = pl(mid);
      if (!p || p.out || s.finished || (!force && !isLethal(p))) continue;
      closeSheets();
      koOpen = true;
      // Ausgeschiedene nicht anbieten (Main.dc.html:2455); Spitzenreiter erst danach markieren
      const candidates = killerCandidates(s, mid).filter((c) => !pl(c.id)?.out)
        .map((c, i) => ({ ...c, name: nm(c.id), top: i === 0 && (c.damage > 0 || c.poison > 0) }));
      showKo(el, {
        player: { id: mid, name: nm(mid) }, deck: deckOf(mid), by, pick: koPick(appRand), candidates,
        round: s.round, life: { victim: p.life, by: by != null ? (pl(by)?.life ?? null) : null, start: s.setup?.startingLife ?? null },
        onEliminate: (byId) => { koOpen = false; doAct({ type: 'eliminate', target: mid, by: byId ?? null }); },
        onCancel: () => { koOpen = false; nextKo(); },
      });
      return;
    }
    if (s.finished && !endShown) { endShown = true; closeSheets(); openEnd(); }
  }

  const sheetOpen = () => !!document.querySelector('.sheet-wrap');

  on(el, 'click', '[data-act]', (e, b) => {
    if (stopped || sheetOpen()) return; // Tippen bei offenem Sheet: wirkungslos
    const a = b.dataset.act; const mid = b.dataset.pid;
    if (a === 'tap') {
      const p = pl(mid);
      if (!p || p.out || s.finished) return;
      doAct({ type: 'life', target: mid, d: Number(b.dataset.v) });
    } else if (a === 'endturn') doAct({ type: 'endTurn', at: Date.now() });
    else if (a === 'menu') openMenu();
    else if (a === 'counters') openCounters(mid);
    else if (a === 'ko') { koQueue.push({ mid, by: null, force: false }); nextKo(); }
  });

  // ---------- Spielmenü
  let rollKind = 'w6';
  let rollRes = null;
  let rolling = null; // Flacker-Intervall

  function liveHtml() {
    const st = rec.status; const n = st.pending;
    const S = {
      saved: ['cloudCheck', t('life.live.saved'), t('life.live.savedSub')],
      saving: ['cloudArrowUp', t('life.live.saving', { n }), t('life.live.savingSub')],
      offline: ['cloudSlash', t('life.live.offline', { n }), t('life.live.offlineSub')],
      error: ['warn', t('life.live.error', { msg: st.error || '' }), t('life.live.errorSub')],
    }[st.state] || ['cloudCheck', t('life.live.saved'), t('life.live.savedSub')];
    return html`<button type="button" class="lc-live" data-m="retry" data-state="${st.state}">${icon(S[0], 22)}
      <span class="grow"><b data-live-text>${S[1]}</b><small>${S[2]}</small></span>${st.state === 'error' ? html`<span class="lc-retry">${t('life.live.retry')}</span>` : ''}</button>`;
  }

  function rollBoxHtml() {
    if (rollRes) {
      const L = t('life.rand');
      const tx = rollText(rollRes, L, (seat) => nm(bySeat(seat)?.id));
      return html`<span class="r" data-roll>${tx.big}</span><span class="s">${tx.sub}</span><span class="a">${L.again}</span>`;
    }
    return html`${icon('diceFive', 30)}<span class="r lbl">${t(`life.rand.act.${rollKind}`)}</span><span class="a">${t('life.rand.tap')}</span>`;
  }

  function zugHtml() {
    const cur = bySeat(s.turn);
    const nx = s.finished ? null : bySeat(act(s, { type: 'endTurn', at: Date.now() }).state.turn);
    const dn = s.daynight ?? 'off';
    return html`<div class="lc-stats3"><div><b class="num">${s.round}</b><small>${t('life.round')}</small></div>
        <div><b class="num" data-clock="turn">${mmss(secondsSince(s.turnStartedAt, Date.now()))}</b><small>${t('life.menu.turnOf', { name: cur ? nm(cur.id) : '' })}</small></div>
        <div><b class="num" data-clock="total">${mmss(secondsSince(startedAt, Date.now()))}</b><small>${t('life.menu.total')}</small></div></div>
      <button type="button" class="btn" data-m="endturn" ${s.finished ? 'disabled' : ''}>${t('life.menu.endTurnTo')}${icon('chevRight', 18)}<span class="lc-next">${nx ? nm(nx.id) : ''}</span></button>
      <div class="lc-mrow"><span class="grow"><b>${t('life.menu.daynight')}</b><small>${t('life.menu.daynightSub')}</small></span>
        <div class="seg lc-dn">${[['off', null, ''], ['tag', 'tag', 'sun'], ['nacht', 'nacht', 'moon']].map(([k, v, ic]) => html`<button type="button" data-m="dn" data-v="${v ?? ''}" aria-pressed="${String(dn === k)}">${ic ? icon(ic, 15) : ''}${t(`life.menu.dn.${k}`)}</button>`)}</div></div>
      <div class="lc-mrow"><span class="grow"><b>${t('life.menu.storm')}</b><small>${t('life.menu.stormSub')}</small></span>
        <div class="lc-stepper"><button type="button" data-m="storm" data-v="-1" aria-label="${t('life.menu.stormLess')}">${icon('minus', 18)}</button>
          <span class="lc-val num" data-storm>${s.storm}</span>
          <button type="button" data-m="storm" data-v="1" aria-label="${t('life.menu.stormMore')}">${icon('plus', 18)}</button></div></div>`;
  }

  function toolsHtml() {
    return html`<div class="seg lc-kinds">${ROLL_KINDS.map((k) => html`<button type="button" data-m="kind" data-k="${k}" aria-pressed="${String(rollKind === k)}">${t(`life.rand.kinds.${k}`)}</button>`)}</div>
      <button type="button" class="lc-rollbox" data-m="roll" aria-live="polite">${rollBoxHtml()}</button>
      <div class="lc-msec"><span class="su-eyebrow">${t('life.layout')}</span>
        <div class="lc-chips">${LAYOUTS.map((k) => html`<button type="button" class="lc-pill" data-m="layout" data-l="${k}" aria-pressed="${String(layout === k)}">${t(`setup.layouts.${k}`)}</button>`)}</div>
        <span class="lc-hint">${t('life.layoutHint')}</span></div>
      <div class="lc-msec"><span class="su-eyebrow">${t('life.live.title')}</span><div data-part="live">${liveHtml()}</div></div>`;
  }

  function logHtml() {
    const L = t('life.log');
    const name = (x, kind) => (kind === 'seat' ? nm(bySeat(x)?.id) : nm(x));
    const ctr = (k) => (k === 'tax2' ? t('life.counters.labels.tax2', { name: '2' }) : t(`life.counters.labels.${k}`));
    const list = history(s).slice().reverse();
    return html`<button type="button" class="btn soft" data-m="undo" ${canUndo(s) ? '' : 'disabled'}>${icon('arrowCounterClockwise', 18)}${t('life.undo')}</button>
      <div class="lc-log">${list.length
        ? list.map((en) => html`<div class="lc-logrow"><small>R${en.round}</small><span>${logText(en, L, name, ctr)}</span></div>`)
        : html`<span class="lc-hint">${t('life.logEmpty')}</span>`}</div>`;
  }

  function openMenu(tab = 'zug') {
    if (sheetOpen()) return;
    let cur = tab;
    const body = () => html`<div class="seg lc-tabs">${['zug', 'tools', 'log'].map((k) => html`<button type="button" data-m="tab" data-t="${k}" aria-pressed="${String(cur === k)}">${t(`life.menu.tabs.${k}`)}</button>`)}</div>
      <div class="lc-mbody" data-tab="${cur}">${cur === 'zug' ? zugHtml() : cur === 'tools' ? toolsHtml() : logHtml()}</div>
      <div class="lc-foot"><button type="button" data-m="home">${icon('home', 16)}${t('life.menu.home')}</button>
        <button type="button" class="danger" data-m="end">${icon('flag', 16)}${t('life.menu.end')}</button></div>`;
    sheet(t('life.menu.title'), html`<div class="su-sheet lc-menu" data-sheet="menu">${body()}</div>`, (sh, close) => {
      const box = $('[data-sheet="menu"]', sh);
      const repaint = () => { if (box.isConnected) mount(box, body()); };
      menu = {
        close, repaint,
        live: () => { const lv = $('[data-part="live"]', box); if (lv) mount(lv, liveHtml()); },
      };
      watchClose(sh, () => {
        menu = null;
        if (rolling) { clearInterval(rolling.iv); clearTimeout(rolling.to); finishRoll(rolling.r); }
      });
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        const m = b.dataset.m;
        if (m === 'tab') { cur = b.dataset.t; repaint(); return; }
        if (m === 'home') { close(); go('/start'); return; }
        if (m === 'end') { close(); openEnd(); return; }
        if (m === 'endturn') { doAct({ type: 'endTurn', at: Date.now() }); repaint(); return; }
        if (m === 'dn') { doAct({ type: 'global', key: 'daynight', value: b.dataset.v || null }); repaint(); return; }
        if (m === 'storm') { doAct({ type: 'storm', d: Number(b.dataset.v) }); repaint(); return; }
        if (m === 'undo') { doAct({ type: 'undo' }); repaint(); return; }
        if (m === 'kind') { if (rolling) return; rollKind = b.dataset.k; rollRes = null; repaint(); return; }
        if (m === 'roll') { startRoll(b); return; }
        if (m === 'layout') { layout = b.dataset.l; lsSet(layoutKey(id), layout); renderBoard(); repaint(); return; }
        if (m === 'retry') { rec.flush().catch(() => {}); }
      });
    });
  }

  // Randomizer: Ergebnis steht vor dem Flackern fest (roll + appRand), Flackern ist nur Anzeige
  function finishRoll(r) {
    rolling = null;
    rollRes = r;
    doAct({ type: 'roll', kind: r.kind, values: r.values, winnerSeat: r.winnerSeat });
    menu?.repaint();
  }

  function startRoll(box) {
    if (rolling) return;
    let r;
    try { r = roll(rollKind, s.players, appRand); } catch (ex) { toast(errText(ex)); return; }
    if (reducedMotion()) { finishRoll(r); return; }
    const L = t('life.rand');
    const alive = s.players.filter((p) => !p.out);
    let i = 0;
    const show = () => {
      const v = flickerValue(rollKind, i++, alive.length);
      const big = rollKind === 'coin' ? (v === 0 ? L.heads : L.tails) : rollKind === 'player' ? nm(alive[v]?.id) : v;
      mount(box, html`<span class="r flicker" data-roll-flicker>${big}</span><span class="s"></span><span class="a">&nbsp;</span>`);
    };
    show();
    rolling = { r, iv: setInterval(show, 60), to: null };
    rolling.to = setTimeout(() => { clearInterval(rolling.iv); finishRoll(r); }, FLICKER_MS);
  }

  // ---------- Zähler-Sheet „⋯“
  function openCounters(mid) {
    if (sheetOpen()) return;
    const d = deckOf(mid);
    let more = false;
    const label = (k, p) => {
      if (k === 'tax' && p.partner && d) return t('life.counters.taxOf', { name: shortCmd(d.commander_name) });
      if (k === 'tax2') return t('life.counters.labels.tax2', { name: shortCmd(d?.partner_name) });
      return t(`life.counters.labels.${k}`);
    };
    const body = () => {
      const p = pl(mid);
      const pins = Array.isArray(d?.counter_pins) ? d.counter_pins : DEFAULT_PINS;
      const { top, rest } = counterRows(p, { partner: p.partner, pins, max: MAX });
      const row = (r) => {
        const lb = label(r.key, p);
        const hint = r.key === 'tax' || r.key === 'tax2' ? (r.value ? t('life.counters.taxCost', { n: 2 * r.value }) : t('life.counters.taxHint')) : '';
        const lim = r.max != null && r.max < 999 ? r.max : null;
        return html`<div class="lc-ctr" data-key="${r.key}">
          <button type="button" class="lc-pin" data-c="pin" data-k="${r.pin}" aria-pressed="${String(r.pinned)}" aria-label="${t(r.pinned ? 'life.counters.unpin' : 'life.counters.pin', { label: lb })}">${icon(r.pinned ? 'pushPinFill' : 'pushPin', 18)}</button>
          <span class="lab">${icon(CTR_ICON[r.key] || 'star', 18)}<span><b>${lb}</b>${hint ? html`<small>${hint}</small>` : ''}</span></span>
          <div class="lc-stepper"><button type="button" data-c="step" data-k="${r.key}" data-v="-1" aria-label="${t('life.counters.less', { label: lb })}">${icon('minus', 18)}</button>
            <span class="lc-val num ${lim != null && r.value >= lim ? 'dead' : r.value ? 'hot' : ''}" data-val>${r.value}${lim != null ? html`<small>/${lim}</small>` : ''}</span>
            <button type="button" data-c="step" data-k="${r.key}" data-v="1" aria-label="${t('life.counters.moreOf', { label: lb })}">${icon('plus', 18)}</button></div></div>`;
      };
      const mode = d ? fieldMode(d) : 'art';
      const cols = d ? modeColors(d) : [];
      const sw = mode === 'art' && d?.image_url ? `background:#000 ${cssUrl(d.image_url)} center 30% / cover` : `background:${cols[0] || 'var(--ln)'}`;
      return html`<div class="su-sh-head"><span class="t"><h3>${nm(mid)}</h3><small>${cmdLine(d)}</small></span>
          <button type="button" class="btn small" data-c="done">${t('life.counters.done')}</button></div>
        <div class="lc-ctrs">${top.map(row)}</div>
        ${rest.length ? html`<button type="button" class="lc-morebtn" data-c="more" aria-expanded="${String(more)}">${t('life.counters.more')}${icon('chevDown', 20)}</button>` : ''}
        ${more && rest.length ? html`<div class="lc-ctrs">${rest.map(row)}</div>` : ''}
        ${d ? html`<span class="lc-hint">${t('life.counters.pinHint', { deck: d.short_name || shortCmd(d.commander_name) })}</span>` : ''}
        <div class="lc-chips">${FLAGS.map(([k, ic]) => html`<button type="button" class="lc-pill" data-c="flag" data-k="${k}" aria-pressed="${String(!!p[k])}">${icon(ic, 16)}${t(`life.counters.flags.${k}`)}</button>`)}</div>
        ${d ? html`<button type="button" class="lc-optrow" data-c="color"><span class="lc-sw" style="${sw}"></span><span class="grow">${t('setup.field.title')}</span>
          <small>${t(mode === 'art' ? 'setup.field.art' : mode === 'commander' ? 'setup.field.commander' : 'setup.field.own')}</small>${icon('chevRight', 16)}</button>` : ''}
        ${p.out || s.finished ? '' : html`<button type="button" class="lc-optrow danger" data-c="out">${icon('skull', 18)}${t('life.counters.out')}</button>`}`;
    };
    sheet(t('life.counters.title', { name: nm(mid) }), html`<div class="su-sheet lc-ctrsheet" data-sheet="counters">${body()}</div>`, (sh, close) => {
      const box = $('[data-sheet="counters"]', sh);
      const repaint = () => { if (box.isConnected) mount(box, body()); };
      ctrSheet = { close, repaint };
      watchClose(sh, () => { ctrSheet = null; });
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        const c = b.dataset.c; const k = b.dataset.k;
        if (c === 'done') { close(); return; }
        if (c === 'more') { more = !more; repaint(); return; }
        if (c === 'step') {
          const dd = Number(b.dataset.v);
          doAct(k === 'poison' ? { type: 'poison', target: mid, d: dd } : { type: 'counter', target: mid, key: k, d: dd });
          repaint(); return;
        }
        if (c === 'flag') { doAct({ type: 'flag', target: mid, key: k }); repaint(); return; }
        if (c === 'pin' && d) {
          const before = d.counter_pins;
          const next = togglePin(Array.isArray(before) ? before : DEFAULT_PINS, k);
          d.counter_pins = next; repaint();
          store.setCounterPins(d.id, next).catch((ex) => {
            d.counter_pins = before; repaint();
            toast(`${t('life.counters.pinsFailed')} ${errText(ex)}`);
          });
          return;
        }
        if (c === 'color' && d) {
          close();
          openFieldColor(d, () => { if (!stopped) renderBoard(); }, { name: nm(mid), life: pl(mid).life, store });
          return;
        }
        if (c === 'out') { close(); koQueue.push({ mid, by: null, force: true }); nextKo(); }
      });
    });
  }

  // ---------- Spiel beenden (E4: werten oder verwerfen)
  function openEnd() {
    if (sheetOpen() || stopped) return;
    const rows = byPlace(results(s));
    const body = html`<div class="su-sh-head"><span class="t"><h3>${s.finished ? t('life.end.decided') : t('life.end.title')}</h3>
        <small>${t('life.end.sub', { r: s.round, time: mmss(secondsSince(startedAt, Date.now())) })}</small></span></div>
      <div class="lc-endopt"><b>${t('life.end.rate')}</b><span>${t('life.end.rateSub')}</span>
        <div class="lc-rank">${rows.map((r) => html`<span><b>${r.place}.</b> ${nm(r.id)} <span class="num">${pl(r.id)?.out ? t('life.end.out') : r.finalLife}</span></span>`)}</div>
        <button type="button" class="btn" data-e="finished">${icon('trophy', 18)}${t('life.end.rate')}</button></div>
      <div class="lc-endopt"><b>${t('life.end.discard')}</b><span>${t('life.end.discardSub')}</span>
        <button type="button" class="btn outline lc-danger" data-e="aborted">${icon('trash', 18)}${t('life.end.discard')}</button></div>
      <p class="error" role="alert" hidden></p>
      <button type="button" class="btn soft" data-e="keep">${t('life.end.keep')}</button>`;
    sheet(t('life.end.title'), html`<div class="su-sheet lc-end" data-sheet="end">${body}</div>`, (sh, close) => {
      const err = $('.error', sh);
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-e]');
        if (!b) return;
        const how = b.dataset.e;
        if (how === 'keep') { close(); return; }
        await busy(b, async () => {
          try {
            await store.finishGame(id, s, how);
            stop();
            close();
            toast(t(how === 'finished' ? 'life.end.finished' : 'life.end.discarded'));
            go(how === 'finished' ? `/spiel/${encodeURIComponent(id)}/ende` : '/start', { replace: true });
          } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
        });
      });
    });
  }

  // ---------- Takt, Status, Aufräumen
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(clock);
    for (const h of timers) clearTimeout(h);
    if (rolling) { clearInterval(rolling.iv); clearTimeout(rolling.to); rolling = null; }
    unsub();
    window.removeEventListener('resize', clearHub);
  }
  const clock = setInterval(() => {
    if (isStale() || !el.isConnected) { stop(); return; }
    const now = Date.now();
    const turnTxt = mmss(secondsSince(s.turnStartedAt, now));
    const totalTxt = mmss(secondsSince(startedAt, now));
    for (const c of document.querySelectorAll('[data-clock="turn"]')) c.textContent = turnTxt;
    for (const c of document.querySelectorAll('[data-clock="total"]')) c.textContent = totalTxt;
  }, 1000);
  // Nach Offline/Fehler wieder „Gespeichert“: Anzeigetafel nachziehen (publish versucht es sonst
  // erst bei der nächsten Aktion erneut)
  let lastState = rec.status.state;
  const unsub = rec.onStatus((st) => {
    const cur = st?.state ?? rec.status.state;
    if (cur === 'saved' && lastState !== 'saved' && !stopped) store.publish(id, s);
    lastState = cur;
    menu?.live();
  });
  window.addEventListener('resize', clearHub);

  el.classList.add('lc-screen');
  mount(el, html`<div class="lc" data-game="${id}"></div>`);
  attachAttack(el, { getState: () => s, onApply: doAct, name: nm, deck: deckOf, busy: () => koOpen || stopped });
  renderBoard();
  // Spiel schon entschieden (z. B. nach Neuladen): Abschluss-Sheet anbieten
  if (s.finished) openEnd();
}
