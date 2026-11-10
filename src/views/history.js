// Historie (#/historie): Spiele nach Abend gruppiert, Filter Alle · Siege · Salzig · Mit Foto. Besitzer: P16.
// Daten nur über groupData (Cache), Zahlen nur aus stats.js, Anzeige nur über format.js (WELLE UI-Regel 6).
import { avatarUrls } from '../supabase.js';
import { state, currentMembership } from '../state.js';
import { groupData } from '../lib/data.js';
import { gameSummary } from '../lib/stats.js';
import { fmtAvg } from '../lib/format.js';
import { html, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, empty, viewScope, fromCache, ownNameFits, settled, painter, staleMark, skel } from '../lib/parts.js';
import { GROUP_MAX_AGE_MS } from '../lib/cache.js';
import { t, getLang } from '../i18n/index.js';
import { FILTERS, NO_SESSION, readFilter, writeFilter, validFilter, historyEvenings, byId, deckArt, fmtDayLong, num } from './history-ui.js';

const store = () => { try { return sessionStorage; } catch { return null; } };

export default async function history(el, { isStale, fail }) {
  // P12: gemerkter Stand sofort (oder Gerüst), Auffrischen im Hintergrund; Zeichnen nur bei gleichem Konto + Gruppe
  const sc = viewScope(state, isStale);
  const paint = painter(el);
  const stale = staleMark(el);
  /** @type {any} */
  let data = null;
  let members = byId([]);
  let decks = byId([]);
  let hasGames = false;
  /** @type {Record<string, string|null>} */
  let urls = {};
  const setData = (/** @type {any} */ d) => {
    data = d;
    members = byId(d?.members);
    decks = byId(d?.decks);
    hasGames = (d?.games || []).length > 0;
  };
  const signed = (/** @type {any} */ d) => avatarUrls((d?.members || []).map((m) => m.avatarPath)).catch(() => ({}));

  const meMemberId = currentMembership()?.id ?? null;
  const lang = getLang();
  let filter = readFilter(store());

  const name = (id) => members.get(id)?.name || '–';
  const av = (id, size, extra = {}) => {
    const m = members.get(id);
    return avatar({ name: m?.name || '?', url: m?.avatarPath ? urls[m.avatarPath] : null, size, ...extra });
  };

  const chips = () => FILTERS.map((f) => html`<button type="button" class="hist-chip" data-filter="${f}" aria-pressed="${String(f === filter)}">${t(`history.filters.${f}`)}</button>`);

  const gameCard = (gid) => {
    const s = gameSummary(data, gid);
    if (!s) return '';
    const win = s.placements.find((p) => p.memberId === s.winnerId) || s.placements[0];
    const deck = decks.get(win?.deckId ?? '');
    const deckName = deck?.commanderName || deck?.shortName || '–';
    const winner = name(win?.memberId);
    return html`<a class="hist-game" href="#/partie/${encodeURIComponent(gid)}"
        aria-label="${t('history.openGame', { date: fmtDayLong(s.startedAt, lang), name: winner, deck: deckName })}">
      <span class="hist-art" style="${deckArt(deck)}" role="img" aria-label="${t('history.deckArt', { name: deckName })}">
        ${s.photoPath ? html`<span class="hist-photo-mark" title="${t('history.photo')}">${icon('camera', 15)}</span>` : ''}
      </span>
      <span class="hist-game-body">
        <span class="hist-win">
          <b class="hist-winner">${icon('crown', 16)}<span>${t('history.winsWith', { name: winner })}</span></b>
          <span class="hist-deck">${deckName}</span>
        </span>
        <span class="hist-row">
          <span class="hist-avs" aria-label="${t('history.players', { names: s.placements.map((p) => name(p.memberId)).join(', ') })}">
            ${s.placements.map((p, i) => av(p.memberId, 28, i === 0 ? { ring: true, color: 'var(--hi)' } : {}))}
          </span>
          <span class="hist-facts">
            <span>${t('history.rounds', { n: num(s.rounds) })}</span>
            <span>${t('history.minutes', { n: num(s.minutes) })}</span>
            <span class="hist-salt" title="${t('history.avgSalt')}">${icon('salt', 15)}<span class="num">${fmtAvg(s.avgSalt, lang)}</span><span class="sr-only">${t('history.avgSalt')}</span></span>
          </span>
        </span>
      </span>
    </a>`;
  };

  const eveningBlock = (e) => {
    const loose = e.sessionId === NO_SESSION;
    const loc = e.location;
    const count = e.gameIds.length === 1 ? t('history.games1') : t('history.gamesN', { n: e.gameIds.length });
    const date = loose ? t('history.noSession') : fmtDayLong(e.playedOn, lang);
    const inner = html`
      <span class="grow-col">
        <b class="hist-ev-date">${date}</b>
        <span class="hist-ev-meta">${loc ? html`<span class="hist-ev-loc">${icon('mapPin', 14)}<span>${loc}</span></span>` : ''}<span>${count}</span></span>
      </span>
      ${e.dayWinnerId ? html`<span class="hist-king" title="${t('history.dayWinner', { name: name(e.dayWinnerId) })}">
        ${av(e.dayWinnerId, 30, { ring: true, color: 'var(--hi)' })}<span class="hist-king-ic">${icon('crown', 12)}</span>
        <span class="sr-only">${t('history.dayWinner', { name: name(e.dayWinnerId) })}</span></span>` : ''}
      ${loose ? '' : html`<span class="chev">${icon('chevRight', 18)}</span>`}`;
    return html`<section class="hist-evening">
      ${loose
        ? html`<div class="hist-ev-head">${inner}</div>`
        : html`<a class="hist-ev-head" href="#/abend/${encodeURIComponent(e.sessionId)}" aria-label="${t('history.toRecap', { date })}${e.dayWinnerId ? ` · ${t('history.dayWinner', { name: name(e.dayWinnerId) })}` : ''}">${inner}</a>`}
      <div class="hist-games">${e.gameIds.map(gameCard)}</div>
    </section>`;
  };

  const listHtml = () => {
    if (!hasGames) {
      return html`<div class="card hist-empty">${empty('history', t('history.emptyTitle'), t('history.emptySub'))}
        <a class="btn block" href="#/spielen">${icon('play', 20)}${t('history.startGame')}</a></div>`;
    }
    const list = historyEvenings(data, { filter, meMemberId });
    if (!list.length) return html`<div class="card">${empty('funnel', t('history.emptyFilter'), t('history.emptyFilterSub'))}</div>`;
    return list.map(eveningBlock);
  };

  const draw = () => {
    if (!data) {
      paint(html`
    <h2 class="title-xl">${t('history.title')}</h2>
    <div class="hist-filters" role="group" aria-label="${t('history.filterLabel')}">${chips()}</div>
    <div class="hist-skel">${skel.rows(5)}</div>`, { busy: true });
      return;
    }
    paint(html`
    <h2 class="title-xl">${t('history.title')}</h2>
    ${hasGames ? html`<div class="hist-filters" role="group" aria-label="${t('history.filterLabel')}">${chips()}</div>` : ''}
    <div class="hist-list" aria-live="polite">${listHtml()}</div>`);
  };

  on(el, 'click', '[data-filter]', (e, b) => {
    const f = validFilter(b.getAttribute('data-filter'));
    if (f === filter) return;
    filter = f;
    writeFilter(store(), f);
    el.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c.getAttribute('data-filter') === f)));
    if (data) draw();
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
    if (g.cached) { console.warn('Historie auffrischen', e); stale.bad(g.cached.at); } else fail(e);
  });
}
