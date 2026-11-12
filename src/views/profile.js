// Profil (eigenes oder fremdes Mitglied der aktuellen Playgroup)
import { sb, must, avatarUrls, avatarUrlsNow, appUrl } from '../supabase.js';
import { state, currentMembership, currentGroup, isAdmin, isSuperadmin, updateProfile, loadMe } from '../state.js';
import { html, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, pathAvatar, backHead, empty, memberName, memberAvatarPath, roleChip, manaPips, viewScope, fromCache, ownNameFits, settled, painter, staleMark, skel } from '../lib/parts.js';
import { pageCache, cacheKey, GROUP_MAX_AGE_MS } from '../lib/cache.js';
import { decksOf, sortColors, bracketName } from '../lib/decks.js';
import { sheet, toast, errText, copyText, openPhoto } from '../lib/ui.js';
import { setAvatar, removeAvatar } from '../lib/avatar.js';
import { t, fmtDate, getLang } from '../i18n/index.js';
import { go, backTarget } from '../router.js';
import { groupData } from '../lib/data.js';
import { memberProfile, deckProfile, memberTimes } from '../lib/stats.js';
import { fmtAvg, fmtPct, fmtMmss } from '../lib/format.js';
import { runMemberRemoval, canRemoveMember } from './member-remove.js';
import { kpis, section, moodRows, saltBars, pointsLine, highlight, deckThumb, iconDisc, moreStats } from './stats-ui.js';

// Decks auf- oder zugeklappt: pro Gerät gemerkt (reine Ansichtssache)
const DECKS_KEY = 'ttg.decksOpen';
const decksOpenPref = () => { try { return localStorage.getItem(DECKS_KEY) !== '0'; } catch { return true; } };
const setDecksOpenPref = (v) => { try { localStorage.setItem(DECKS_KEY, v ? '1' : '0'); } catch { /* egal */ } };
// „Erweitert“ (Zugzeiten, Spieldauer; Spec P1): Standard zu, pro Gerät gemerkt, gilt für alle Profile
const MORE_KEY = 'ttg.statsMore';
const moreOpenPref = () => { try { return localStorage.getItem(MORE_KEY) === '1'; } catch { return false; } };
const setMoreOpenPref = (v) => { try { localStorage.setItem(MORE_KEY, v ? '1' : '0'); } catch { /* egal */ } };
// Wie MEMBER_SELECT (groups.js) + is_superadmin des Zielprofils: kein Entfernen-Knopf beim Superadmin (P10 B1)
const PROFILE_MEMBER_SELECT = '*, profiles!members_profile_id_fkey(display_name, avatar_path, is_superadmin)';

export default async function profile(el, { params, isStale, fail }) {
  const mineId = currentMembership()?.id;
  const memberId = params.memberId || mineId;
  // P12: eigenes Profil (#/profil) zeichnet sofort den Kopf und den gemerkten Stand (page:profil = Mitglieds-Zeile
  // + Decks), sonst ein Gerüst; Auffrischen im Hintergrund. Fremdes Profil wie bisher (Lade-Kreis), aber mit den
  // gemerkten Gruppen-Daten. Gezeichnet wird nur bei gleichem Konto + Gruppe (Riegel 14b).
  const own = !params.memberId;
  const sc = viewScope(state, isStale);
  const paint = painter(el);
  const stale = staleMark(el);
  const pageKey = own ? sc.key('page:profil') : null;
  const loadPage = async () => {
    const row = await sb.from('members').select(PROFILE_MEMBER_SELECT).eq('id', memberId).maybeSingle().then(must);
    return { m: row, decks: row ? await decksOf(row) : [] };
  };
  const avPathOf = (/** @type {any} */ x) => (x.profile_id && x.profile_id === state.profile?.id ? state.profile.avatar_path : memberAvatarPath(x));
  const signed = (/** @type {any} */ x) => avatarUrls([avPathOf(x)]).catch(() => ({}));
  const notFound = () => paint(html`${backHead(t('nav.me'), '#/gruppen')}${empty('user', t('profile.notFound'), '')}`);

  /** @type {any} */
  let m = null;
  /** @type {any[]|null} null = Decks noch nicht geladen (Gerüst) */
  let decks = null;
  /** @type {any} Statistik: eine Rechenquelle (stats.js über groupData, WELLE D3); ein Ausfall bricht das Profil nicht */
  let data = null;
  /** @type {'wait'|'ok'|'error'} */
  let statsState = 'wait';
  /** @type {Record<string, string|null>} */
  let urls = {};
  let isMe = false;
  let isGuest = false;
  let removed = false;
  let canEdit = false;
  let canRemove = false;
  let name = '';
  /** @type {string|null} */
  let avPath = null;
  /** @type {any} */
  let target = null;
  let avUrl = '';
  const lang = getLang();
  const showBack = !!params.memberId && params.memberId !== mineId;
  const deckLine = (id) => {
    if (!data) return '';
    const dp = deckProfile(data, id);
    return dp.games ? t('stats.deckLine', { games: gamesText(dp.games), rate: fmtPct(dp.winRate, lang) }) : t('decks.noGames');
  };

  let drawSeq = 0;
  const draw = async () => {
    const seq = ++drawSeq;
    isMe = m.profile_id && m.profile_id === state.profile?.id;
    isGuest = !m.profile_id;
    removed = !!m.removed_at; // P10: entfernte Zeile ist eingefroren (kein Umbenennen, kein Bild, kein Code)
    canEdit = !removed && (isMe || isGuest); // Bild und Name: eigenes Profil und Spieler ohne Konto
    // P10 H/K7: Entfernen-Knopf für Gruppen-Admins (und Superadmin), nicht bei Admins, nicht beim Superadmin, nicht bei sich selbst
    canRemove = canRemoveMember(m, { isMe: !!isMe, isAdmin: isAdmin(), isSuperadmin: isSuperadmin() });
    name = isMe ? state.profile.display_name : memberName(m);
    avPath = avPathOf(m);
    const pr = data ? memberProfile(data, m.id) : null;
    const statsHtml = statsState === 'wait' ? skel.block(true)
      : pr ? await profileStats({ pr, data, isMe: !!isMe, name, lang, memberId: m.id, moreOpen: moreOpenPref() }) : html`<p class="small muted st-err">${t('stats.loadError')}</p>`;
    if (!sc.ok() || seq !== drawSeq) return;
    const group = state.memberships.find((x) => x.playgroup_id === m.playgroup_id)?.playgroups || currentGroup();
    target = isMe ? { kind: 'profile', id: state.profile.id } : { kind: 'member', id: m.id };

    avUrl = urls[avPath] || '';
    const decksOpen = decksOpenPref(); // beim Neuzeichnen gilt der zuletzt gewählte Zustand
    const av = pathAvatar({ name, path: avPath, urls, size: 72 });
    const avView = html`<button type="button" class="avatar-view" data-act="avatar-zoom" aria-label="${t('avatar.view', { name })}">${av}</button>`;
    paint(html`
    ${showBack || isMe ? html`<div class="prof-top">
      ${showBack ? html`<a class="icon-btn" href="${backTarget('#/gruppen', (h) => !/^#\/(profil\/|login|registrieren|beitreten|passwort)/.test(h))}" aria-label="${t('common.back')}">${icon('back')}</a>` : html`<span></span>`}
      ${isMe ? html`<a class="icon-btn" href="#/einstellungen" aria-label="${t('profile.settings')}">${icon('gear', 22)}</a>` : ''}
    </div>` : ''}
    <div class="prof-head">
      ${canEdit
        ? (avUrl
          ? html`<span class="avatar-edit">${avView}<button type="button" class="cam" data-act="photo" aria-label="${t('avatar.change', { name })}">${icon('camera', 14)}</button></span>`
          : html`<button type="button" class="avatar-edit" data-act="photo" aria-label="${t('avatar.change', { name })}">${av}<span class="cam">${icon('camera', 14)}</span></button>`)
        : (avUrl ? avView : av)}
      <div class="grow-col">
        <h2 class="prof-name">${name}${canEdit ? html`<button type="button" class="rename" data-act="rename" aria-label="${t('profile.rename')}">${icon('edit', 16)}</button>` : ''}</h2>
        <span class="small muted">${t('profile.since', { group: group?.name || '', date: fmtDate(m.created_at) })}</span>
        <span>${roleChip(m)}</span>
      </div>
    </div>

    ${isGuest && !removed && m.claim_code ? html`
    <div class="guest-card">
      <b>${t('profile.guestTitle', { name })}</b>
      <span class="hint">${t('profile.guestText', { name })}</span>
      <div class="code-row">
        <span class="code">${m.claim_code}</span>
        <button type="button" class="btn small" data-act="claim-link">${icon('copy', 16)}${t('groups.copyLink')}</button>
      </div>
    </div>` : ''}

    ${statsHtml}

    ${decks == null ? html`<div class="section">
      <div class="section-head"><h3 class="section-title">${t('profile.decks')}</h3></div>
      ${skel.rows(2)}
    </div>` : html`<div class="section">
      <button type="button" class="collapse-head" data-act="toggle-decks" aria-expanded="${decksOpen}" aria-controls="prof-decks">
        <h3 class="section-title">${t('profile.decks')} <span class="count">${decks.length}</span></h3>
        ${decks.length ? html`<span class="deck-minis" aria-hidden="true">${decks.slice(0, 5).map((d) => html`<i style="background-image:url('${d.image_url}')"></i>`)}</span>` : ''}
        <span class="chev">${icon('chevDown', 20)}</span>
      </button>
      <div id="prof-decks" class="section" ${decksOpen ? '' : html`hidden`}>
      ${decks.length ? html`<div class="decks">${decks.map((d) => html`
        <a class="deck-card" href="#/deck/${d.id}">
          <span class="arts ${d.partner_image_url ? 'split' : ''}">${[d.image_url, d.partner_image_url].filter(Boolean).map((a) => html`<span style="background-image:url('${a}')"></span>`)}</span>
          <span class="info"><b>${d.short_name}</b><span class="meta">${manaPips(sortColors(d.color_identity), 10)}<span>${t('decks.bracket')} ${d.bracket} · ${bracketName(d.bracket)}</span></span>${data ? html`<span class="st-deck-line tiny muted">${deckLine(d.id)}</span>` : ''}</span>
        </a>`)}</div>` : html`<div class="card">${empty('play', t('decks.none'), isMe || isGuest ? '' : t('decks.noneOther', { name }))}</div>`}
      ${canEdit ? html`<a class="btn soft" href="#/deck-neu/${m.id}">${icon('plus', 20)}${t('decks.add')}</a>` : ''}
      </div>
    </div>`}

    ${!isGuest && !isMe && (m.role === 'admin' ? isAdmin() || isSuperadmin() : isSuperadmin()) ? html`
    <button type="button" class="btn soft" data-act="role">${icon('shield', 18)}${m.role === 'admin' ? t('profile.removeAdmin') : t('profile.makeAdmin')}</button>` : ''}
    ${canRemove ? html`
    <button type="button" class="btn danger" data-act="remove-member">${icon('trash', 18)}${t('memberRemove.button')}</button>` : ''}

`, { busy: decks == null });
  };

  const groupOf = (/** @type {string} */ gid) => fromCache(cacheKey(sc.uid, gid, 'group'), (o) => groupData.loadGroup(gid, o), { maxAge: GROUP_MAX_AGE_MS, fits: ownNameFits(state) });
  const watchGroup = (/** @type {ReturnType<typeof groupOf>} */ g) => g.promise?.then((d) => {
    if (!sc.ok()) return;
    data = d; statsState = 'ok';
    if (m) draw();
  }, (ex) => {
    if (!sc.ok()) return;
    console.warn('Statistik laden', ex);
    if (g.cached) stale.bad(g.cached.at);
    else { statsState = 'error'; if (m) draw(); }
  });

  if (!own || !currentMembership()) {
    // Fremdes Profil: wie bisher erst laden, dann zeichnen
    const v = await loadPage();
    if (isStale()) return;
    m = v.m; decks = v.decks;
    if (!m) { notFound(); return; }
    const g = groupOf(m.playgroup_id || state.groupId);
    if (g.cached) { data = g.cached.value; statsState = 'ok'; } else {
      data = await g.promise.catch((ex) => { console.warn('Statistik laden', ex); return null; });
      statsState = data ? 'ok' : 'error';
    }
    urls = await signed(m);
    if (isStale()) return;
    await draw();
    if (g.cached) watchGroup(g);
  } else {
    const p = fromCache(pageKey, (o) => pageCache.load(pageKey, loadPage, o));
    const g = groupOf(sc.gid);
    // Kopf sofort: gemerkte Mitglieds-Zeile, sonst die eigene Mitgliedschaft (Name/Bild aus dem eigenen Profil)
    m = p.cached?.value.m || currentMembership();
    decks = p.cached?.value.decks ?? null;
    if (g.cached) { data = g.cached.value; statsState = 'ok'; }
    const u = signed(m);
    const now = await settled(u);
    if (!sc.ok()) return;
    // P6: noch offen ⇒ was ohne Netz bekannt ist (lokales Bild, gültige Signatur), sonst leerer Kreis
    urls = now || avatarUrlsNow([avPathOf(m)]);
    if (!now) u.then((x) => { if (sc.ok()) { urls = { ...x, ...urls }; draw(); } });
    await draw();
    stale.from(p.cached?.failed ? p.cached : g.cached?.failed ? { at: p.cached?.at ?? g.cached.at, failed: true } : undefined);
    p.promise?.then(async (v) => {
      if (!sc.ok()) return;
      if (!v.m) { notFound(); return; }
      const u = await signed(v.m);
      if (!sc.ok()) return;
      m = v.m; decks = v.decks; urls = u;
      draw();
    }, (ex) => {
      if (!sc.ok()) return;
      if (p.cached) { console.warn('Profil auffrischen', ex); stale.bad(p.cached.at); } else fail(ex);
    });
    watchGroup(g);
    Promise.allSettled([p.promise, g.promise].filter(Boolean)).then((rs) => {
      if (sc.ok() && rs.every((r) => r.status === 'fulfilled')) stale.good();
    });
  }

  const rerender = () => go(location.hash.slice(1));

  on(el, 'click', '[data-act="avatar-zoom"]', () => { if (avUrl) openPhoto(avUrl, t('avatar.alt', { name }), { round: true }); });
  on(el, 'click', '[data-act="photo"]', () => openAvatarSheet({ name, url: urls[avPath], has: !!avPath, path: avPath, target, isMe, onDone: () => { groupData.invalidate(m.playgroup_id || state.groupId); rerender(); } })); // P12 Nachtrag 1 (B2)
  on(el, 'click', '[data-act="rename"]', () => openRename({ name, isMe, member: m, onDone: rerender }));
  on(el, 'click', '[data-act="claim-link"]', () => copyText(appUrl(`#/code/${m.claim_code}`)));
  on(el, 'click', '[data-act="toggle-decks"]', (e, b) => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    el.querySelector('#prof-decks').hidden = !open;
    setDecksOpenPref(open);
  });
  on(el, 'click', '[data-act="toggle-more"]', (e, b) => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    el.querySelector('#prof-more').hidden = !open;
    setMoreOpenPref(open);
  });
  on(el, 'click', '[data-act="role"]', async (e, b) => {
    await busy(b, async () => {
      try {
        must(await sb.rpc('set_member_role', { p_member: m.id, p_role: m.role === 'admin' ? 'member' : 'admin' }));
        toast(t('profile.roleChanged')); rerender();
      } catch (ex) { toast(errText(ex)); }
    });
  });
  // P10 G/H: Ablauf in member-remove.js; hier nur Bestätigung (Sheet) und Ergebnis
  on(el, 'click', '[data-act="remove-member"]', async (e, b) => {
    let round = 0;
    await busy(b, async () => {
      try {
        const res = await runMemberRemoval(sb, m, {
          confirm: (c) => confirmRemoval({ name, check: c, account: !!m.profile_id, again: round++ > 0 }),
          invalidate: () => groupData.invalidate(m.playgroup_id),
        });
        if (res === 'cancelled') return;
        if (res === 'unavailable') { toast(t('auth.errors.unavailable')); return; }
        toast(t(`memberRemove.${res === 'deleted' ? 'deleted' : res === 'marked' ? 'marked' : 'already'}`, { name }));
        groupData.invalidate(m.playgroup_id);
        if (res === 'deleted') go('/gruppen', { replace: true }); else rerender();
      } catch (ex) { toast(errText(ex)); }
    });
  });
}

/** Text der Bestätigung nach Modus des Probelaufs (Spec H; Block K: Konto-Ziel). */
function removalLines({ name, check: c, account }) {
  const n = (k1, kn, v) => t(v === 1 ? k1 : kn, { n: v, name });
  if (c.mode === 'delete') {
    return [t(account ? 'memberRemove.deleteTextAccount' : 'memberRemove.deleteText', { name }), c.decks > 0 ? n('memberRemove.deleteDecksOne', 'memberRemove.deleteDecks', c.decks) : '',
      account ? t('memberRemove.accountBack', { name }) : ''].filter(Boolean);
  }
  return [
    `${c.games > 0 ? n('memberRemove.markGamesOne', 'memberRemove.markGames', c.games) : t('memberRemove.markGamesNone', { name })} ${t(account ? 'memberRemove.markRestAccount' : 'memberRemove.markRest', { name })}`,
    c.live_games > 0 ? t('memberRemove.live', { name }) : '',
    account ? t('memberRemove.accountBack', { name }) : '',
  ].filter(Boolean);
}

/** Bestätigungs-Sheet; löst mit true (Ja) oder false (Abbrechen, Tippen daneben, Escape, Routenwechsel) auf. */
function confirmRemoval({ name, check, account, again }) {
  return new Promise((resolve) => {
    const del = check.mode === 'delete';
    sheet(t('memberRemove.title', { name }), html`
      <h2 class="sheet-title">${t('memberRemove.title', { name })}</h2>
      ${again ? html`<p class="note warn" role="status" data-again>${icon('warn', 16)}<span>${t('memberRemove.again')}</span></p>` : ''}
      <div data-remove-mode="${check.mode}">${removalLines({ name, check, account }).map((l) => html`<p class="sheet-text">${l}</p>`)}</div>
      <button type="button" class="btn block ${del ? 'danger-fill' : 'danger'}" data-act="remove-yes">${icon('trash', 18)}${t(del ? 'memberRemove.yesDelete' : 'memberRemove.yesMark')}</button>
      <button type="button" class="btn block soft" data-act="cancel">${t('common.cancel')}</button>`, (sh, close) => {
      let done = false;
      const onKey = (ev) => { if (ev.key === 'Escape') end(false); };
      const end = (v) => { if (!done) { done = true; document.removeEventListener('keydown', onKey); resolve(v); } };
      sh.parentElement.querySelector('.scrim').addEventListener('click', () => end(false));
      document.addEventListener('keydown', onKey);
      window.addEventListener('hashchange', () => end(false), { once: true });
      on(sh, 'click', '[data-act="cancel"]', () => { end(false); close(); });
      on(sh, 'click', '[data-act="remove-yes"]', () => { end(true); close(); });
    });
  });
}

// ---- Statistik (P18) ----
const gamesText = (n) => t(n === 1 ? 'stats.games1' : 'stats.gamesN', { n });

/**
 * Statistik-Teil des Profils (Kacheln, Stimmung, Verläufe, Tempo, Highlights) aus memberProfile.
 * Ohne Spiele nur die Kacheln (0/–), keine leeren Diagramme (Spec P18, Kriterium 4).
 * Danach „Erweitert“ (Spec P1: Zugzeiten, Spieldauer; auf/zu nach moreOpen).
 * @param {{ pr: import('../lib/stats.js').MemberProfile, data: import('../lib/history-data.js').GroupData, isMe: boolean, name: string, lang: string, memberId: string, moreOpen: boolean }} o
 */
async function profileStats({ pr, data, isMe, name, lang, memberId, moreOpen }) {
  const tiles = kpis([
    { v: pr.games, l: t('profile.stats.games') },
    { v: pr.wins, l: t('profile.stats.wins') },
    { v: pr.points, l: t('profile.stats.points') },
    { v: fmtAvg(pr.avgPlace, lang), l: t('profile.stats.place') },
    { v: fmtPct(pr.winRate, lang), l: t('stats.winRate') },
  ]);
  if (!pr.games) return tiles;

  const members = new Map((data.members || []).map((x) => [x.id, x]));
  const decks = new Map((data.decks || []).map((x) => [x.id, x]));
  const who = (id) => members.get(id)?.name || '–';
  const deckName = (id) => decks.get(id)?.shortName || decks.get(id)?.commanderName || '–';
  const deckHref = (id) => `#/deck/${encodeURIComponent(id)}`;

  const mood = section(t('stats.mood'), moodRows([
    { icon: 'salt', label: t('stats.avgSalt'), value: pr.avgSalt },
    { icon: 'smiley', label: t('stats.avgFun'), value: pr.avgFun },
    { icon: 'starFill', label: t('stats.avgDeck'), value: pr.avgDeckRating },
  ], lang));
  const salt = pr.saltTrend.length ? section(t('stats.saltTrend'), saltBars(pr.saltTrend)) : '';
  const line = pr.pointsSeries.length >= 2 ? section(t('stats.pointsTrend'), pointsLine(pr.pointsSeries)) : '';

  const tp = pr.tempo;
  const tempo = tp.avgTurnSec != null && tp.rank != null ? section(t('stats.tempo'), html`<div class="card st-tempo">
    <span class="st-ic" aria-hidden="true">${icon('timer', 22)}</span>
    <span class="grow-col"><b>${t('stats.tempoLine', { time: fmtMmss(tp.avgTurnSec), rank: tp.rank, of: tp.of })}</b>${
      tp.of > 1 && tp.rank === 1 ? html`<span class="small muted">${t('stats.slowest')}</span>` : ''}${
      tp.of > 1 && tp.rank === tp.of ? html`<span class="small muted">${t('stats.fastest')}</span>` : ''}</span>
  </div>`) : '';

  // Highlights: nur vorhandene Kacheln
  const hl = [];
  if (pr.nemesis) {
    const nm = members.get(pr.nemesis.memberId);
    let url = null;
    if (nm?.avatarPath) { try { url = (await avatarUrls([nm.avatarPath]))[nm.avatarPath] || null; } catch { url = null; } }
    hl.push(highlight({
      label: t('stats.nemesis'),
      text: t(isMe ? 'stats.nemesisMe' : 'stats.nemesisOther', { name: who(pr.nemesis.memberId), who: name, n: pr.nemesis.count }),
      media: avatar({ name: who(pr.nemesis.memberId), url, size: 44 }),
      href: `#/profil/${encodeURIComponent(pr.nemesis.memberId)}`,
    }));
  }
  const fav = pr.favoriteDeck; const best = pr.bestDeck;
  if (fav && best && fav.deckId === best.deckId) {
    // Lieblingsdeck = bestes Deck ⇒ eine Kachel mit beiden Aussagen (statt zweimal dasselbe Bild)
    hl.push(highlight({
      label: t('stats.favBestDeck'), text: deckName(fav.deckId),
      sub: `${gamesText(fav.games)} · ${t('stats.winRateLine', { v: fmtPct(best.winRate, lang) })}`,
      media: deckThumb(decks.get(fav.deckId)?.imageUrl, deckName(fav.deckId)), href: deckHref(fav.deckId),
    }));
  } else {
    if (fav) hl.push(highlight({
      label: t('stats.favDeck'), text: deckName(fav.deckId), sub: gamesText(fav.games),
      media: deckThumb(decks.get(fav.deckId)?.imageUrl, deckName(fav.deckId)), href: deckHref(fav.deckId),
    }));
    if (best) hl.push(highlight({
      label: t('stats.bestDeck'), text: deckName(best.deckId), sub: t('stats.winRateLine', { v: fmtPct(best.winRate, lang) }),
      media: deckThumb(decks.get(best.deckId)?.imageUrl, deckName(best.deckId)), href: deckHref(best.deckId),
    }));
  }
  if (pr.longestStreak > 0) hl.push(highlight({
    label: t('stats.streak'), text: t(pr.longestStreak === 1 ? 'stats.streak1' : 'stats.streakN', { n: pr.longestStreak }), media: iconDisc('fire'),
  }));
  if (pr.fastestWin) hl.push(highlight({
    label: t('stats.fastestWin'), text: t('stats.inRounds', { n: pr.fastestWin.rounds }), media: iconDisc('lightning'),
    href: `#/partie/${encodeURIComponent(pr.fastestWin.gameId)}`,
  }));
  const highlights = hl.length ? section(t('stats.highlights'), html`<div class="st-hls">${hl}</div>`) : '';

  const more = moreStats({ times: memberTimes(data, memberId), memberId, name, isMe, who, open: moreOpen, lang });

  return html`${tiles}${mood}${salt}${line}${tempo}${highlights}${more}`;
}

function openAvatarSheet({ name, url, has, path = null, target, isMe, onDone }) {
  sheet(t('avatar.title'), html`
    <div class="prof-head">
      ${avatar({ name, url, size: 64 })}
      <div class="grow-col"><span class="sheet-title">${t('avatar.title')}</span><span class="small muted">${isMe ? name : t('avatar.forWhom', { name })}</span></div>
    </div>
    <label class="sheet-opt">${icon('camera', 20, 1.8)}<span>${t('avatar.take')}</span><input type="file" accept="image/*" capture="user"></label>
    <label class="sheet-opt">${icon('image', 20, 1.8)}<span>${t('avatar.gallery')}</span><input type="file" accept="image/*"></label>
    ${has ? html`<button type="button" class="sheet-opt danger" data-act="remove">${icon('trash', 20, 1.8)}<span>${t('avatar.remove')}</span></button>` : ''}
    <p class="error" role="alert" hidden></p>
    <span class="hint">${t('avatar.hint')}</span>`, (sh, close) => {
    const err = sh.querySelector('.error');
    const done = async (fn, msg) => {
      sh.setAttribute('aria-busy', 'true');
      try { await fn(); if (isMe) await loadMe(); close(); toast(msg); onDone(); }
      catch (ex) { err.textContent = /kein Bild|decode|toBlob/i.test(ex.message) ? t('avatar.tooBig') : errText(ex); err.hidden = false; }
      finally { sh.removeAttribute('aria-busy'); }
    };
    on(sh, 'change', 'input[type=file]', (e, input) => {
      const f = input.files?.[0];
      if (f) done(() => setAvatar(target, f, path), t('avatar.saved'));
    });
    on(sh, 'click', '[data-act="remove"]', () => done(() => removeAvatar(target, path), t('avatar.removed')));
  });
}

function openRename({ name, isMe, member, onDone }) {
  sheet(t('profile.rename'), html`
    <h2>${t('profile.rename')}</h2>
    <form class="form" novalidate>
      <div class="field"><label for="rn-name">${t('auth.name')}</label>
        <input id="rn-name" class="input" maxlength="40" value="${name}" autocomplete="off"></div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('profile.save')}</button>
    </form>`, (sh, close) => {
    on(sh, 'submit', 'form', async (e) => {
      e.preventDefault();
      const err = sh.querySelector('.error');
      const v = sh.querySelector('#rn-name').value.trim();
      if (!v || v.length > 40) { err.textContent = t('auth.errors.name'); err.hidden = false; return; }
      await busy(sh.querySelector('button[type=submit]'), async () => {
        try {
          if (isMe) {
            await updateProfile({ display_name: v });
            // Kopie des Namens in allen eigenen Mitgliedschaften mitziehen
            must(await sb.from('members').update({ display_name: v }).eq('profile_id', state.profile.id));
            await loadMe();
          } else {
            must(await sb.from('members').update({ display_name: v }).eq('id', member.id));
            groupData.invalidate(member.playgroup_id); // P12 Nachtrag 1 (B2): eigener Schreibvorgang ⇒ Gruppen-Stand verworfen
          }
          close(); toast(t('profile.saved')); onDone();
        } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
      });
    });
  });
}
