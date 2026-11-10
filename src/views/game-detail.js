// Spieldetail (#/partie/:id): Kopf, Platzierung, Schadensmatrix, POTG, Notiz, Foto. Besitzer: P16.
// Daten nur über groupData.loadGame, Zahlen nur aus stats.js (gameSummary), Anzeige nur über format.js.
// Spielerfarben nur in der Schadensmatrix (Diagramm, WELLE UI-Regel 2).
import { avatarUrls, photoUrls } from '../supabase.js';
import { state, currentMembership } from '../state.js';
import { groupData } from '../lib/data.js';
import { gameSummary } from '../lib/stats.js';
import { fmtAvg, fmtMmss } from '../lib/format.js';
import { playerColor } from '../lib/decks.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, backHead, empty } from '../lib/parts.js';
import { t, getLang } from '../i18n/index.js';
import { openPhoto } from '../lib/ui.js';
import { WINCONS, byId, deckArt, colorDeck, damageGrid, fmtDateTime, num } from './history-ui.js';

export default async function gameDetail(el, { params, isStale }) {
  const id = params?.id || '';
  const back = backHead('', '#/historie');
  /** @type {any} */
  let data = null;
  try { data = await groupData.loadGame(id); } catch (e) { console.warn('Spiel laden', e); data = null; }
  if (isStale()) return;

  // Unbekannt, nicht sichtbar (RLS) oder aus einer anderen Playgroup ⇒ Leerzustand mit Zurück
  if (!data || !data.game || data.groupId !== state.groupId) {
    mount(el, html`${back}<div class="card">${empty('history', t('history.unknown'), t('history.unknownSub'))}
      <a class="btn soft block" href="#/historie">${icon('back', 18)}${t('history.backToHistory')}</a></div>`);
    return;
  }

  const game = data.game;
  const lang = getLang();
  const when = fmtDateTime(game.startedAt, lang);

  if (game.status === 'live') {
    mount(el, html`${back}<div class="card">${empty('live', t('history.live'), t('history.liveSub'))}
      <a class="btn block" href="#/spiel/${encodeURIComponent(game.id)}">${icon('eye', 20)}${t('history.watch')}</a></div>`);
    return;
  }
  if (game.status !== 'finished') {
    mount(el, html`${back}<div class="card">${empty('close', t('history.aborted'), t('history.abortedSub'))}
      <span class="small muted gd-when">${when}</span></div>`);
    return;
  }

  const s = gameSummary(data, game.id);
  if (!s) {
    mount(el, html`${back}<div class="card">${empty('history', t('history.unknown'), t('history.unknownSub'))}</div>`);
    return;
  }

  const members = byId(data.members);
  const decks = byId(data.decks);
  const session = byId(data.sessions).get(s.sessionId ?? '');
  /** @type {Record<string, string|null>} */
  let avUrls = {};
  /** @type {Record<string, string|null>} */
  let phUrls = {};
  try {
    [avUrls, phUrls] = await Promise.all([
      avatarUrls((data.members || []).map((m) => m.avatarPath)).catch(() => ({})),
      s.photoPath ? photoUrls([s.photoPath]).catch(() => ({})) : Promise.resolve({}),
    ]);
  } catch { /* Bilder sind Beiwerk */ }
  if (isStale()) return;

  const name = (mid) => members.get(mid)?.name || '–';
  const av = (mid, size, extra = {}) => {
    const m = members.get(mid);
    return avatar({ name: m?.name || '?', url: m?.avatarPath ? avUrls[m.avatarPath] : null, size, ...extra });
  };
  const deckOf = (did) => decks.get(did ?? '') || null;
  const deckTitle = (d) => d?.shortName || d?.commanderName || '–';

  const winner = s.placements.find((p) => p.memberId === s.winnerId) || null;
  const wDeck = deckOf(winner?.deckId);
  const wincon = s.wincon && WINCONS.includes(s.wincon) ? t(`history.wincon.${s.wincon}`) : '–';
  const meId = currentMembership()?.id ?? null;
  const iPlayed = !!meId && s.placements.some((p) => p.memberId === meId);
  const photo = s.photoPath ? phUrls[s.photoPath] || null : null;

  const outcomeText = (p) => {
    const life = num(p.finalLife);
    const round = num(p.eliminatedRound);
    if (p.outcome === 'win') return t('history.outcome.win', { life });
    if (p.outcome === 'out') return t('history.outcome.out', { round, name: name(p.eliminatedBy) });
    if (p.outcome === 'conceded') return t('history.outcome.conceded', { round });
    return t('history.outcome.alive', { life });
  };

  // ---- Platzierung
  const placementRows = s.placements.map((p) => {
    const d = deckOf(p.deckId);
    const isWin = p.outcome === 'win';
    return html`<div class="row static gd-place ${isWin ? 'win' : ''}">
      <span class="gd-disc num" aria-label="${t('history.place', { n: num(p.place) })}">${isWin ? icon('crown', 18) : num(p.place)}</span>
      ${av(p.memberId, 40, isWin ? { ring: true, color: 'var(--hi)' } : {})}
      <span class="grow">
        <span class="title">${name(p.memberId)}${isWin ? html`<span class="sr-only"> · ${t('history.winner')}</span>` : ''}</span>
        <span class="gd-deck"><span class="gd-thumb" style="${deckArt(d)}" role="img" aria-label="${t('history.deckArt', { name: d?.commanderName || deckTitle(d) })}"></span><span>${deckTitle(d)}</span></span>
        <span class="sub wrap">${outcomeText(p)}</span>
      </span>
      <span class="gd-side">
        <b class="num">${t('history.points', { n: num(p.points) })}</b>
        <span class="num">${t('history.avgTurn', { t: fmtMmss(p.avgTurnSec) })}</span>
      </span>
    </div>`;
  });

  // ---- Schadensmatrix (Zeile = Quelle, Spalte = Ziel); Spielerfarbe nur hier
  const order = s.placements.map((p) => p.memberId);
  const grid = damageGrid(order, data.damage);
  const dot = (mid) => {
    const p = s.placements.find((x) => x.memberId === mid);
    return html`<span class="gd-dot" style="background:${playerColor(colorDeck(deckOf(p?.deckId)))}" aria-hidden="true"></span>`;
  };
  const matrix = grid.empty
    ? html`<p class="small muted gd-none">${t('history.damageNone')}</p>`
    : html`<div class="gd-matrix-wrap"><table class="gd-matrix">
        <caption class="sr-only">${t('history.damageCaption')}</caption>
        <thead><tr><th scope="col" class="gd-corner"><span class="sr-only">${t('history.damageFrom')}</span></th>
          ${order.map((mid) => html`<th scope="col"><span class="gd-colhead">${dot(mid)}<span class="gd-ini">${name(mid).slice(0, 3)}</span></span><span class="sr-only">${name(mid)}</span></th>`)}
        </tr></thead>
        <tbody>${order.map((src) => html`<tr>
          <th scope="row"><span class="gd-rowhead">${dot(src)}<span>${name(src)}</span></span></th>
          ${order.map((tgt) => {
            if (src === tgt) return html`<td class="self" aria-hidden="true"></td>`;
            const c = grid.cell(src, tgt);
            if (!c) return html`<td class="zero"><span aria-hidden="true">·</span></td>`;
            return html`<td><b class="num">${num(c.damage)}</b>${c.commanderDamage ? html`<span class="gd-extra" title="${t('history.commanderDamage', { n: c.commanderDamage })}">${icon('sword', 11)}<span class="num">${c.commanderDamage}</span><span class="sr-only">${t('history.commanderDamage', { n: c.commanderDamage })}</span></span>` : ''}${c.poison ? html`<span class="gd-extra" title="${t('history.poison', { n: c.poison })}">${icon('drop', 11)}<span class="num">${c.poison}</span><span class="sr-only">${t('history.poison', { n: c.poison })}</span></span>` : ''}</td>`;
          })}
        </tr>`)}</tbody>
      </table></div>`;

  // ---- POTG
  const potg = s.potg || { winners: [], votes: {}, texts: [] };
  const votesText = (n) => (n === 1 ? t('history.votes1') : t('history.votesN', { n }));
  const potgBlock = potg.winners.length
    ? html`${potg.winners.map((mid) => html`<div class="gd-potg-win">${av(mid, 44)}<span class="grow-col"><b>${name(mid)}</b><span class="small muted">${votesText(potg.votes[mid] ?? 0)}</span></span><span class="gd-medal">${icon('medal', 22)}</span></div>`)}
      ${potg.texts.map((x) => html`<figure class="gd-quote"><span class="gd-quote-ic">${icon('quotes', 18)}</span><blockquote>${x.text}</blockquote>
        <figcaption>${t('history.potgBy', { name: name(x.voterId), target: name(x.votedFor) })}</figcaption></figure>`)}`
    : html`<p class="small muted gd-none">${t('history.potgNone')}</p>`;

  mount(el, html`
    ${back}
    <section class="gd-hero">
      <span class="gd-hero-art" style="${deckArt(wDeck)}" role="img" aria-label="${t('history.deckArt', { name: wDeck?.commanderName || deckTitle(wDeck) })}"></span>
      <div class="gd-hero-text">
        <span class="gd-when">${icon('calendarBlank', 15)}<span>${when}</span></span>
        <h2>${winner ? t('history.winsWith', { name: name(winner.memberId) }) : t('history.detailTitle')}</h2>
        <span class="gd-hero-deck">${wDeck?.commanderName || deckTitle(wDeck)}</span>
        <span class="gd-tags">
          <span class="gd-tag" title="${t('history.winconLabel')}">${icon('trophy', 14)}${wincon}</span>
          ${session?.location ? html`<span class="gd-tag gd-loc">${icon('mapPin', 14)}<span>${session.location}</span></span>` : ''}
        </span>
      </div>
    </section>

    <div class="stats gd-stats">
      <div class="stat"><b>${num(s.rounds)}</b><span>${t('history.roundsLabel')}</span></div>
      <div class="stat"><b>${num(s.minutes)}</b><span>${t('history.minutesLabel')}</span></div>
      <div class="stat"><b class="gd-ic-num">${icon('salt', 16)}${fmtAvg(s.avgSalt, lang)}</b><span>${t('history.avgSalt')}</span></div>
      <div class="stat"><b class="gd-ic-num">${icon('smiley', 16)}${fmtAvg(s.avgFun, lang)}</b><span>${t('history.avgFun')}</span></div>
    </div>

    <section class="section">
      <h3 class="section-title">${t('history.placement')}</h3>
      <div class="list">${placementRows}</div>
    </section>

    <section class="section">
      <h3 class="section-title">${t('history.damage')}</h3>
      <div class="card gd-card">${matrix}</div>
    </section>

    <section class="section">
      <h3 class="section-title">${t('history.potg')}</h3>
      <div class="card gd-card">${potgBlock}</div>
    </section>

    ${s.note ? html`<section class="section">
      <h3 class="section-title">${t('history.note')}</h3>
      <div class="card gd-note"><span class="gd-note-ic">${icon('notePencil', 18)}</span><p>${s.note}</p></div>
    </section>` : ''}

    ${photo ? html`<section class="section gd-photo-sec">
      <h3 class="section-title">${t('history.photoTitle')}</h3>
      <button type="button" class="gd-photo" data-act="photo" aria-label="${t('history.photoOpen')}">
        <img src="${photo}" alt="${t('history.photoAlt', { date: when })}" loading="lazy">
      </button>
    </section>` : ''}

    <div class="gd-actions">
      ${iPlayed ? html`<a class="btn block" href="#/spiel/${encodeURIComponent(game.id)}/ende">${icon('starFill', 20)}${t('history.rate')}</a>` : ''}
      ${s.sessionId ? html`<a class="btn soft block" href="#/abend/${encodeURIComponent(s.sessionId)}">${icon('calendarBlank', 20)}${t('history.toEvening')}</a>` : ''}
    </div>`);

  // Foto: Ladefehler ⇒ Abschnitt weglassen (error bubbelt nicht ⇒ direkt am Bild)
  const img = el.querySelector('.gd-photo img');
  img?.addEventListener('error', () => el.querySelector('.gd-photo-sec')?.remove(), { once: true });

  on(el, 'click', '[data-act="photo"]', () => { if (photo) openPhoto(photo, t('history.photoAlt', { date: when })); });
}
