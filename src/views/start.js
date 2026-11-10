// Startseite: Gruppe, Einladung zur nächsten Runde, eure Runde, Rangliste
// Live-Anzeigetafel laufender Spiele (P8); Rangliste Top 3 und „Zuletzt gespielt“ (P20).
// P12: zuletzt geladener Stand (page:start) sofort, sonst Gerüst; Auffrischen bei jedem Besuch im Hintergrund.
// Mitglieder ∥ laufende Spiele ∥ Gruppen-Daten; davon abhängig Decks ∥ Bild-Adressen. Das erste Zeichnen ohne
// gemerkten Stand wartet nicht auf die Gruppen-Daten (Abschnitt „Rangliste“ zeigt solange Platzhalter).
import { sb, must, avatarUrls } from '../supabase.js';
import { state, currentGroup } from '../state.js';
import { html, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, empty, memberName, memberAvatarPath, viewScope, fromCache, ownNameFits, settled, painter, staleMark, skel } from '../lib/parts.js';
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
import { pageCache, GROUP_MAX_AGE_MS } from '../lib/cache.js';

export default async function start(el, { isStale, fail }) {
  const sc = viewScope(state, isStale);
  const paint = painter(el);
  const stale = staleMark(el);
  const pageKey = sc.key('page:start');
  /** page:start = Mitglieder, neuestes Deck je Mitglied, laufende Spiele (Daten, nie HTML)
   * @type {{ members: any[], latest: Record<string, any>, live: any[] } | null} */
  let page = null;
  /** @type {any} Gruppen-Daten (Rangliste Top 3, Zuletzt gespielt) */
  let stats = null;
  /** @type {'wait'|'ok'|'error'} */
  let statsState = 'wait';
  /** @type {Record<string, string|null>} */
  let urls = {};
  const paths = (/** @type {any[]} */ members) => [state.profile?.avatar_path, ...members.map(memberAvatarPath)];
  const signed = (/** @type {any[]} */ members) => avatarUrls(paths(members)).catch(() => ({}));

  const loadPage = async () => {
    const gid = sc.gid;
    const prevLive = pageCache.peek(pageKey)?.value?.live;
    // Anzeigetafel: ein Fehler hier lässt die Startseite unverändert (bisherige Liste, sonst keine)
    const liveP = createStore(sb).liveGames(gid).catch((e) => { console.warn('Laufende Spiele', e); return prevLive || []; });
    const ownUrl = signed([]);
    const members = await sb.from('members').select(MEMBER_SELECT).eq('playgroup_id', gid).order('created_at').then(must);
    const [latest, live] = await Promise.all([latestDeckByMember(members), liveP, signed(members), ownUrl]);
    return { members, latest, live };
  };

  const view = () => {
    const g = currentGroup();
    const me = state.profile;
    const top0 = (/** @type {any} */ avHtml) => html`<div class="top">
      <a class="group-switch" href="#/gruppen" aria-label="${t('home.switchGroup')}: ${g?.name}"><span>${g?.name}</span>${icon('chevDown', 18)}</a>
      <span class="brand-logo" role="img" aria-label="Tracking the Gathering"></span>
      <a href="#/profil" aria-label="${t('nav.me')}" class="avatar-link">${avHtml}</a>
    </div>`;
    const hero = (/** @type {any} */ myDeck) => html`<div class="art-hero" ${myDeck?.image_url ? html`style="--art:url('${myDeck.image_url}')"` : ''}>
      ${myDeck?.image_url ? '' : html`<span class="art-credit">Diabolic Tutor · Brain Dead</span>`}
      <h2>${t('home.newRound')}</h2>
      <p>${t('home.newRoundSub')}</p>
      <div class="btns">
        <a class="btn" href="#/spielen">${icon('plus', 20)}${t('home.newGame')}</a>
        <button class="btn outline" type="button" data-act="live">${icon('live', 20)}${t('home.joinGame')}</button>
      </div>
    </div>`;

    // Gerüst (Entscheid 8): Kopfzeile, Karte „Neue Runde“, ruhige Platzhalter
    if (!page) {
      return html`${top0(avatar({ name: me?.display_name, url: urls[me?.avatar_path], size: 42 }))}
    ${hero(null)}
    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('home.players')}</h3><a href="#/gruppen">${t('home.all')}</a></div>
      ${skel.people(5)}
    </div>
    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('home.leaderboard')}</h3></div>
      ${skel.block()}
    </div>`;
    }

    const { members, latest, live } = page;
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
    // P12: Namen zuerst aus den frisch geladenen Mitgliedern (nach eigenem Umbenennen nie der alte Name)
    const dbMember = new Map(members.map((m) => [m.id, m]));
    const statMembers = new Map((stats?.members || []).map((m) => [m.id, m]));
    const statName = (mid) => (dbMember.get(mid) ? memberName(dbMember.get(mid)) : statMembers.get(mid)?.name || '–');
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

    const board = statsState === 'wait'
      ? skel.block()
      : top.length ? html`<div class="card home-top">${top.map((r) => {
        const m = dbMember.get(r.memberId);
        return html`<a class="home-top-row" href="#/profil/${encodeURIComponent(r.memberId)}" data-top="${r.memberId}" data-rank="${r.rank}">
          <span class="home-rank num" aria-label="${t('result.homeRank', { n: r.rank })}">${r.rank}</span>
          ${m ? personAv(m, 36) : avatar({ name: statName(r.memberId), url: null, size: 36 })}
          <span class="rs-name">${statName(r.memberId)}</span>
          <b class="home-pts num">${t('result.homePoints', { n: r.points })}</b></a>`;
      })}</div>`
        // Gruppen-Ladung gescheitert und kein Stand: kein „Noch keine Spiele“ (Entscheid 15)
        : statsState === 'error' ? html`<div class="card"><p class="small muted st-err">${t('stats.loadError')}</p></div>`
          : html`<div class="card">${empty('trophy', t('home.noGames'), t('home.noGamesSub'))}</div>`;

    return html`
    ${top0(mine ? personAv(mine, 42) : avatar({ name: me?.display_name, url: urls[me?.avatar_path], size: 42 }))}

    ${hero(myDeck)}

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
      ${board}
    </div>

    ${recent.length ? html`<div class="section">
      <div class="section-head"><h3 class="section-title">${t('result.homeRecent')}</h3></div>
      <div class="card home-recent">${recent.map((r) => html`<a class="home-recent-row" href="#/partie/${encodeURIComponent(r.id)}" data-recent="${r.id}" aria-label="${t('result.homeRecentOpen', { date: r.date, name: r.winner })}">
        <span class="home-thumb" style="${deckArt(r.deck)}" aria-hidden="true"></span>
        <span class="rs-grow"><span class="rs-name">${t('result.homeWins', { name: r.winner })}</span><span class="rs-sub">${r.date}</span></span>
        <span class="chev">${icon('chevRight', 18)}</span></a>`)}</div>
    </div>` : ''}`;
  };
  const draw = () => paint(view(), { busy: !page });

  // „Spiel beitreten“ (P6): laufendes Spiel der aktuellen Gruppe öffnen — frisch gefragt, Rückfall die geladene Liste
  on(el, 'click', '[data-act="live"]', async () => {
    const games = await createStore(sb).liveGames(state.groupId).catch(() => page?.live || []);
    if (isStale()) return;
    if (!games.length) { toast(t('live.none')); return; }
    if (games.length === 1) { go(`/spiel/${games[0].id}`); return; }
    const nameOf = new Map((page?.members || []).map((m) => [m.id, memberName(m)]));
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

  // Beide Ladungen starten sofort und parallel; die Gruppen-Daten nur, wenn fehlend, älter als 60 s oder gescheitert.
  const p = fromCache(pageKey, (o) => pageCache.load(pageKey, loadPage, o));
  const g = fromCache(sc.key('group'), (o) => groupData.loadGroup(sc.gid, o), { maxAge: GROUP_MAX_AGE_MS, fits: ownNameFits(state) });
  if (g.cached) { stats = g.cached.value; statsState = 'ok'; }
  if (p.cached) {
    page = p.cached.value;
    const u = signed(page.members);
    urls = (await settled(u)) || {};
    if (!sc.ok()) return;
  } else {
    urls = (await settled(signed([]))) || {};
    if (!sc.ok()) return;
  }
  draw();

  p.promise?.then(async (v) => {
    if (!sc.ok()) return;
    const u = await signed(v.members);
    if (!sc.ok()) return;
    page = v; urls = u; draw();
  }, (e) => {
    if (!sc.ok()) return;
    if (p.cached) { console.warn('Startseite auffrischen', e); stale.bad(p.cached.at); } else fail(e);
  });
  g.promise?.then((d) => {
    if (!sc.ok()) return;
    stats = d; statsState = 'ok';
    if (page) draw();
  }, (e) => {
    if (!sc.ok()) return;
    console.warn('Gruppendaten', e);
    if (g.cached) stale.bad(p.cached?.at ?? g.cached.at);
    else { statsState = 'error'; if (page) draw(); }
  });
  // Ausfallserie endet erst, wenn in diesem Besuch alles gelang (Entscheid 15)
  Promise.allSettled([p.promise, g.promise].filter(Boolean)).then((rs) => {
    if (sc.ok() && rs.every((r) => r.status === 'fulfilled')) stale.good();
  });
}
