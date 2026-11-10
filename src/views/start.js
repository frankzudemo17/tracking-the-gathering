// Startseite: Gruppe, Einladung zur nächsten Runde, eure Runde, Rangliste
// Live-Anzeigetafel laufender Spiele (P8); Rangliste Top 3 und „Zuletzt gespielt“ (P20).
import { sb, must, avatarUrls } from '../supabase.js';
import { state, currentGroup } from '../state.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, empty, memberName, memberAvatarPath } from '../lib/parts.js';
import { sheet, toast } from '../lib/ui.js';
import { go } from '../router.js';
import { t, getLang } from '../i18n/index.js';
import { MEMBER_SELECT } from './groups.js';
import { latestDeckByMember } from '../lib/decks.js';
import { createStore } from '../lib/game-store.js';
import { critical } from './life-ui.js';
import { groupData } from '../lib/data.js';
import { playerTable } from '../lib/stats.js';
import { deckArt } from './history-ui.js';
import { recentGames, fmtShortDate } from './result-ui.js';

export default async function start(el, { isStale }) {
  const g = currentGroup();
  const me = state.profile;
  const members = await sb.from('members').select(MEMBER_SELECT).eq('playgroup_id', state.groupId).order('created_at').then(must);
  const [urls, latest, live, stats] = await Promise.all([
    avatarUrls([me?.avatar_path, ...members.map(memberAvatarPath)]),
    latestDeckByMember(members),
    // Anzeigetafel: ein Fehler hier lässt die Startseite unverändert
    createStore(sb).liveGames(state.groupId).catch((e) => { console.warn('Laufende Spiele', e); return []; }),
    // Rangliste + Zuletzt gespielt (P20): ein Fehler hier lässt den bestehenden Leerzustand stehen
    groupData.loadGroup(state.groupId).catch((e) => { console.warn('Gruppendaten', e); return null; }),
  ]);
  if (isStale()) return;
  const mine = members.find((m) => m.profile_id === me?.id);
  const myDeck = mine ? latest[mine.id] : null;
  // Spielerbild: Foto, sonst Commander-Art des neuesten Decks, sonst Initialen
  const personAv = (m, size) => {
    const d = latest[m.id];
    return avatar({ name: memberName(m), url: urls[memberAvatarPath(m)] || d?.image_url || null, size });
  };
  const nameOf = new Map(members.map((m) => [m.id, memberName(m)]));
  // Anzeigetafel je laufendem Spiel (HANDOFF 4 Startseite): Kacheln aus games.live_state
  const boardCard = (gm) => {
    const ls = gm.live_state && Array.isArray(gm.live_state.players) ? gm.live_state : null;
    const snap = new Map((ls?.players || []).map((p) => [p.id, p]));
    const round = ls?.round ?? gm.round ?? 1;
    const min = Math.max(0, Math.floor((Date.now() - (Date.parse(gm.started_at) || Date.now())) / 60000));
    return html`<a class="lc-board-card" href="#/spiel/${gm.id}" data-live-game="${gm.id}" aria-label="${t('life.board.open')}">
      <div class="hd"><span class="lc-livedot">${t('life.board.live')}</span><b>${t('life.board.title')}</b><small>${t('life.board.meta', { r: round, min })}</small></div>
      <div class="lc-tiles">${gm.players.map((p) => {
        const sp = snap.get(p.member_id);
        const turn = !!(ls && sp && !sp.out && !ls.finished && sp.seat === ls.turn);
        const crit = critical(sp);
        return html`<div class="lc-tile ${turn ? 'turn' : ''} ${sp?.out ? 'out' : ''} ${crit ? 'crit-on' : ''}" data-tile="${p.member_id}" ${p.deck?.image_url ? html`style="--img:url('${p.deck.image_url}')"` : ''}>
          ${crit ? html`<span class="crit">${t('life.board.crit')}</span>` : ''}
          <span class="n num" data-life>${sp ? sp.life : '–'}</span><span class="nm">${nameOf.get(p.member_id) || p.name}</span></div>`;
      })}</div></a>`;
  };

  // Rangliste Top 3 + letzte 3 Spiele (P20): Zahlen nur aus stats.js, Daten nur über groupData
  const dbMember = new Map(members.map((m) => [m.id, m]));
  const statMembers = new Map((stats?.members || []).map((m) => [m.id, m]));
  const statName = (mid) => statMembers.get(mid)?.name || (dbMember.get(mid) ? memberName(dbMember.get(mid)) : '–');
  const top = stats?.games?.length ? playerTable(stats).slice(0, 3) : [];
  const statDecks = new Map((stats?.decks || []).map((d) => [d.id, d]));
  const recent = recentGames(stats?.games).map((gm) => {
    const w = (stats?.players || []).find((p) => p.gameId === gm.id && p.place === 1);
    return { id: gm.id, winner: w ? statName(w.memberId) : '–', deck: statDecks.get(w?.deckId ?? '') || null, date: fmtShortDate(gm.startedAt, getLang()) };
  });

  // eigenes Profil zuerst, dann alphabetisch
  // P10: Leute-Leiste nur aktive Mitglieder (Filter im Client, Übergangsregel H); Namen oben lösen weiter alle auf
  const people = members.filter((m) => !m.removed_at)
    .sort((a, b) => (b.profile_id === me?.id) - (a.profile_id === me?.id) || memberName(a).localeCompare(memberName(b), 'de'));

  mount(el, html`
    <div class="top">
      <a class="group-switch" href="#/gruppen" aria-label="${t('home.switchGroup')}: ${g?.name}"><span>${g?.name}</span>${icon('chevDown', 18)}</a>
      <span class="brand-logo" role="img" aria-label="Tracking the Gathering"></span>
      <a href="#/profil" aria-label="${t('nav.me')}" class="avatar-link">${mine ? personAv(mine, 42) : avatar({ name: me?.display_name, url: urls[me?.avatar_path], size: 42 })}</a>
    </div>

    <div class="art-hero" ${myDeck?.image_url ? html`style="--art:url('${myDeck.image_url}')"` : ''}>
      ${myDeck?.image_url ? '' : html`<span class="art-credit">Diabolic Tutor · Brain Dead</span>`}
      <h2>${t('home.newRound')}</h2>
      <p>${t('home.newRoundSub')}</p>
      <div class="btns">
        <a class="btn" href="#/spielen">${icon('plus', 20)}${t('home.newGame')}</a>
        <button class="btn outline" type="button" data-act="live">${icon('live', 20)}${t('home.joinGame')}</button>
      </div>
    </div>

    ${live.map(boardCard)}

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('home.players')}</h3><a href="#/gruppen">${t('home.all')}</a></div>
      <div class="people">
        ${people.map((m) => html`<a class="person" href="#/profil/${m.id}">${personAv(m, 54)}<span>${memberName(m)}</span></a>`)}
        <a class="person" href="#/spieler-neu"><span class="add">${icon('userPlus', 22)}</span><span>${t('home.addShort')}</span></a>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('home.leaderboard')}</h3>${top.length ? html`<a class="home-all" href="#/rangliste">${t('result.homeAll')}</a>` : ''}</div>
      ${top.length ? html`<div class="card home-top">${top.map((r) => {
        const m = dbMember.get(r.memberId);
        return html`<a class="home-top-row" href="#/profil/${encodeURIComponent(r.memberId)}" data-top="${r.memberId}" data-rank="${r.rank}">
          <span class="home-rank num" aria-label="${t('result.homeRank', { n: r.rank })}">${r.rank}</span>
          ${m ? personAv(m, 36) : avatar({ name: statName(r.memberId), url: null, size: 36 })}
          <span class="rs-name">${statName(r.memberId)}</span>
          <b class="home-pts num">${t('result.homePoints', { n: r.points })}</b></a>`;
      })}</div>` : html`<div class="card">${empty('trophy', t('home.noGames'), t('home.noGamesSub'))}</div>`}
    </div>

    ${recent.length ? html`<div class="section">
      <div class="section-head"><h3 class="section-title">${t('result.homeRecent')}</h3></div>
      <div class="card home-recent">${recent.map((r) => html`<a class="home-recent-row" href="#/partie/${encodeURIComponent(r.id)}" data-recent="${r.id}" aria-label="${t('result.homeRecentOpen', { date: r.date, name: r.winner })}">
        <span class="home-thumb" style="${deckArt(r.deck)}" aria-hidden="true"></span>
        <span class="rs-grow"><span class="rs-name">${t('result.homeWins', { name: r.winner })}</span><span class="rs-sub">${r.date}</span></span>
        <span class="chev">${icon('chevRight', 18)}</span></a>`)}</div>
    </div>` : ''}`);

  // „Spiel beitreten“ (P6): laufendes Spiel der aktuellen Gruppe öffnen — frisch gefragt, Rückfall die geladene Liste
  on(el, 'click', '[data-act="live"]', async () => {
    const games = await createStore(sb).liveGames(state.groupId).catch(() => live);
    if (isStale()) return;
    if (!games.length) { toast(t('live.none')); return; }
    if (games.length === 1) { go(`/spiel/${games[0].id}`); return; }
    const row = (gm) => {
      const min = Math.max(0, Math.floor((Date.now() - (Date.parse(gm.started_at) || Date.now())) / 60000));
      const who = gm.players.map((p) => nameOf.get(p.member_id) || p.name).join(' · ');
      return html`<button type="button" class="lv-pick" data-pick="${gm.id}">${icon('live', 20)}
        <span class="grow"><b>${who}</b><small>${t('live.pick.meta', { r: gm.live_state?.round ?? gm.round ?? 1, min })}</small></span>${icon('chevRight', 18)}</button>`;
    };
    sheet(t('live.pick.title'), html`<div class="su-sheet lv-picks"><div class="su-sh-head"><span class="t"><h3>${t('live.pick.title')}</h3></span></div>${games.map(row)}</div>`, (sh, close) => {
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        close(); go(`/spiel/${b.dataset.pick}`);
      });
    });
  });
}
