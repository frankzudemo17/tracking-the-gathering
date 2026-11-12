// Rangliste (#/rangliste): Spieler · Decks · Salz, Zeitraum Gesamt · 30 Tage · Jahr. Besitzer: P17.
// Daten nur über groupData (einmal geladen, Umschalter rechnen aus demselben Stand), Zahlen nur aus
// stats.js, Anzeige nur über format.js (WELLE ttg-ende-statistik, UI-Regel 6). Quelle Ablauf: Prototyp
// mockup/design-canvas-quellen/Main.dc.html:2708-2719 (dortige Zahlen sind Attrappen).
import { avatarUrls } from '../supabase.js';
import { state, currentMembership } from '../state.js';
import { groupData } from '../lib/data.js';
import { inRange, playerTable, deckTable, deckSaltTable } from '../lib/stats.js';
import { fmtAvg, fmtPct } from '../lib/format.js';
import { html, on, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, empty, viewScope, fromCache, ownNameFits, settled, painter, staleMark, skel } from '../lib/parts.js';
import { GROUP_MAX_AGE_MS } from '../lib/cache.js';
import { sheet } from '../lib/ui.js';
import { t, getLang } from '../i18n/index.js';
import { MODES, RANGES, readPrefs, writePrefs, pickNow, splitPodium, stepOf, saltFill, deckOwnerId, emptyKind, artStyle } from './board-ui.js';

const store = () => { try { return sessionStorage; } catch { return null; } };

export default async function board(el, { isStale, fail }) {
  // P12: gemerkter Stand sofort (oder Gerüst), Auffrischen im Hintergrund; Zeichnen nur bei gleichem Konto + Gruppe
  const sc = viewScope(state, isStale);
  const paint = painter(el);
  const stale = staleMark(el);
  /** @type {any} */
  let data = null;
  let members = new Map();
  let decks = new Map();
  let allGames = 0;
  /** @type {Record<string, string|null>} */
  let urls = {};
  const setData = (/** @type {any} */ d) => {
    data = d;
    members = new Map((d?.members || []).map((m) => [m.id, m]));
    decks = new Map((d?.decks || []).map((x) => [x.id, x]));
    allGames = (d?.games || []).length;
  };
  const signed = (/** @type {any} */ d) => avatarUrls((d?.members || []).map((m) => m.avatarPath)).catch(() => ({}));

  const meId = currentMembership()?.id ?? null;
  const lang = getLang();
  let prefs = readPrefs(store());

  const name = (id) => members.get(id)?.name || '–';
  const av = (id, size) => {
    const m = members.get(id);
    return avatar({ name: m?.name || '?', url: m?.avatarPath ? urls[m.avatarPath] : null, size });
  };
  const deckName = (d) => d?.shortName || d?.commanderName || '–';
  const art = (d, cls) => html`<span class="${cls}" style="${artStyle(d?.imageUrl)}" role="img" aria-label="${t('board.art', { name: d?.commanderName || deckName(d) })}"><span aria-hidden="true">${initials(deckName(d))}</span></span>`;
  const count = (key, n) => t(`board.${key}${n === 1 ? '1' : 'N'}`, { n });
  const owner = (d) => name(deckOwnerId(d, data?.members || []));

  // ---- Bausteine ----
  const segs = () => html`<div class="brd-seg" role="group" aria-label="${t('board.modeLabel')}">${MODES.map((m) =>
    html`<button type="button" data-mode="${m}" aria-pressed="${m === prefs.mode ? 'true' : 'false'}">${t(`board.modes.${m}`)}</button>`)}</div>`;
  const chips = () => html`<div class="brd-chips" role="group" aria-label="${t('board.rangeLabel')}">${RANGES.map((r) =>
    html`<button type="button" class="brd-chip" data-range="${r}" aria-pressed="${r === prefs.range ? 'true' : 'false'}">${t(`board.ranges.${r}`)}</button>`)}</div>`;

  const statLine = (r) => html`<span class="brd-stats"><span>${count('games', r.games)}</span><span>${count('wins', r.wins)}</span></span>
    <span class="brd-stats"><span>${t('board.winRate', { v: fmtPct(r.winRate, lang) })}</span><span>${t('board.avgPlace', { v: fmtAvg(r.avgPlace, lang) })}</span></span>`;

  const podium = (rows, kind) => html`<ol class="brd-podium" aria-label="${t('board.podium')}">${rows.map((r, i) => {
    const isDeck = kind === 'decks';
    const d = isDeck ? decks.get(r.deckId) : null;
    const label = isDeck ? deckName(d) : name(r.memberId);
    const href = isDeck ? `#/deck/${encodeURIComponent(r.deckId)}` : `#/profil/${encodeURIComponent(r.memberId)}`;
    const mine = !isDeck && r.memberId === meId;
    return html`<li class="brd-pod pos-${i}">
      <a class="brd-pod-link ${mine ? 'me' : ''}" href="${href}" aria-label="${t('board.rowLabel', { rank: r.rank, name: label, points: count('points', r.points) })}">
        ${isDeck ? art(d, 'brd-pod-art') : html`<span class="brd-pod-av">${av(r.memberId, i === 0 ? 72 : 60)}</span>`}
        <span class="brd-pod-name">${label}</span>
        ${isDeck ? html`<span class="brd-pod-sub">${owner(d)}</span>` : ''}
        <span class="brd-step step-${stepOf(r.rank)}">
          <span class="brd-step-rank">${r.rank === 1 ? icon('crown', 18) : ''}<b>${r.rank}</b></span>
          <span class="brd-step-pts"><b>${r.points}</b> ${t('board.pointsShort')}</span>
        </span>
      </a></li>`;
  })}</ol>`;

  const list = (rows, kind) => (rows.length ? html`<div class="list brd-list">${rows.map((r) => {
    const isDeck = kind === 'decks';
    const d = isDeck ? decks.get(r.deckId) : null;
    const label = isDeck ? deckName(d) : name(r.memberId);
    const href = isDeck ? `#/deck/${encodeURIComponent(r.deckId)}` : `#/profil/${encodeURIComponent(r.memberId)}`;
    const mine = !isDeck && r.memberId === meId;
    return html`<a class="row brd-row ${mine ? 'me' : ''}" href="${href}" aria-label="${t('board.rowLabel', { rank: r.rank, name: label, points: count('points', r.points) })}">
      <span class="brd-rank">${r.rank}</span>
      ${isDeck ? art(d, 'brd-art') : av(r.memberId, 40)}
      <span class="grow">
        <span class="title">${label}${isDeck ? html`<span class="brd-owner"> · ${owner(d)}</span>` : ''}</span>
        ${statLine(r)}
      </span>
      <span class="brd-pts"><b>${r.points}</b><span>${t(r.points === 1 ? 'board.point' : 'board.points')}</span></span>
    </a>`;
  })}</div>` : '');

  const saltIcons = (avg) => html`<span class="brd-salt-icons" aria-hidden="true">${saltFill(avg).map((f) =>
    html`<span class="brd-salt-ic" style="--f:${f}"><span class="off">${icon('salt', 13)}</span><span class="on">${icon('salt', 13)}</span></span>`)}</span>`;

  const saltList = (rows) => html`<div class="list brd-list">${rows.map((r) => {
    const d = decks.get(r.deckId);
    const label = deckName(d);
    const v = fmtAvg(r.avgSalt, lang);
    return html`<a class="row brd-row" href="#/deck/${encodeURIComponent(r.deckId)}" aria-label="${t('board.saltRowLabel', { rank: r.rank, name: label, v })}">
      <span class="brd-rank">${r.rank}</span>
      ${art(d, 'brd-art')}
      <span class="grow">
        <span class="title">${label}</span>
        <span class="brd-salt-line">${saltIcons(r.avgSalt)}<span class="brd-stats">${count('ratings', r.ratings)}</span></span>
        ${r.mostSaltedMemberId ? html`<span class="brd-stats"><span>${t('board.mostSalted', { name: name(r.mostSaltedMemberId) })}</span></span>` : ''}
      </span>
      <span class="brd-pts"><b>${v}</b><span>${t('board.avgSalt')}</span></span>
    </a>`;
  })}</div>`;

  const emptyBlock = (kind) => {
    if (kind === 'none') {
      return html`<div class="card">${empty('trophy', t('board.empty.none'), t('board.empty.noneSub'))}
        <a class="btn block" href="#/spielen">${icon('play', 18)}${t('board.empty.start')}</a></div>`;
    }
    if (kind === 'range') return html`<div class="card">${empty('calendarBlank', t('board.empty.range'), t('board.empty.rangeSub'))}</div>`;
    return html`<div class="card">${empty('salt', t('board.empty.salt'), t('board.empty.saltSub'))}</div>`;
  };

  const body = () => {
    const now = pickNow(globalThis.location?.hostname, /** @type {any} */ (globalThis).__ttgNow);
    const d = inRange(data, prefs.range, now);
    const rangeGames = (d?.games || []).length;
    if (prefs.mode === 'salt') {
      const rows = deckSaltTable(d, { min: 2 });
      const kind = emptyKind({ allGames, rangeGames, rows: rows.length, salt: true });
      return html`${kind ? emptyBlock(kind) : saltList(rows)}<p class="brd-note">${t('board.saltNote')}</p>`;
    }
    const rows = prefs.mode === 'decks' ? deckTable(d) : playerTable(d);
    const kind = emptyKind({ allGames, rangeGames, rows: rows.length });
    if (kind) return emptyBlock(kind);
    const { podium: top, rest } = splitPodium(rows);
    return html`${podium(top, prefs.mode)}${list(rest, prefs.mode)}
      <button type="button" class="brd-info" data-act="points">${icon('medal', 18)}<span>${t('board.pointsHow')}</span>${icon('chevRight', 16)}</button>`;
  };

  const draw = () => {
    if (!data) {
      paint(html`<div class="brd">
      <h2 class="title-xl">${t('board.title')}</h2>
      ${segs()}${chips()}
      <div class="brd-skel">${skel.block(true)}${skel.rows(4)}</div>
    </div>`, { busy: true });
      return;
    }
    paint(html`<div class="brd">
      <h2 class="title-xl">${t('board.title')}</h2>
      ${segs()}${chips()}
      <div class="brd-body">${body()}</div>
    </div>`);
  };

  on(el, 'click', '[data-mode]', (_e, b) => {
    prefs = { ...prefs, mode: /** @type {any} */ (b.dataset.mode) };
    writePrefs(store(), prefs);
    draw();
    el.querySelector(`[data-mode="${prefs.mode}"]`)?.focus();
  });
  on(el, 'click', '[data-range]', (_e, b) => {
    prefs = { ...prefs, range: /** @type {any} */ (b.dataset.range) };
    writePrefs(store(), prefs);
    draw();
    el.querySelector(`[data-range="${prefs.range}"]`)?.focus();
  });
  on(el, 'click', '[data-act="points"]', () => {
    sheet(t('board.pointsTitle'), html`<div class="brd-sheet">
      <h3>${t('board.pointsTitle')}</h3>
      <p>${t('board.pointsText')}</p>
      <p class="muted">${t('board.pointsExample')}</p>
    </div>`);
  });

  const g = fromCache(sc.key('group'), (o) => groupData.loadGroup(sc.gid, o), { maxAge: GROUP_MAX_AGE_MS, fits: ownNameFits(state) });
  if (g.cached) {
    setData(g.cached.value);
    const u = signed(data);
    urls = (await settled(u)) || {};
    if (!sc.ok()) return;
    u.then((x) => { if (sc.ok()) { urls = x; draw(); } });
  }
  draw();
  stale.from(g.cached);
  g.promise?.then(async (d) => {
    if (!sc.ok()) return;
    const u = await signed(d);
    if (!sc.ok()) return;
    setData(d); urls = u; draw(); stale.good();
  }, (e) => {
    if (!sc.ok()) return;
    if (g.cached) { console.warn('Rangliste auffrischen', e); stale.bad(g.cached.at); } else fail(e);
  });
}
