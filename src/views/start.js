// Startseite: Gruppe, Einladung zur nächsten Runde, eure Runde, Rangliste
// (Live-Anzeigetafel und letzte Spiele kommen mit Etappe 3/4.)
import { sb, must, avatarUrls } from '../supabase.js';
import { state, currentGroup } from '../state.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, empty, memberName, memberAvatarPath } from '../lib/parts.js';
import { toast } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { MEMBER_SELECT } from './groups.js';
import { latestDeckByMember, playerColor } from '../lib/decks.js';

export default async function start(el, { isStale }) {
  const g = currentGroup();
  const me = state.profile;
  const members = await sb.from('members').select(MEMBER_SELECT).eq('playgroup_id', state.groupId).order('created_at').then(must);
  const [urls, latest] = await Promise.all([
    avatarUrls([me?.avatar_path, ...members.map(memberAvatarPath)]),
    latestDeckByMember(members),
  ]);
  if (isStale()) return;
  const mine = members.find((m) => m.profile_id === me?.id);
  const myDeck = mine ? latest[mine.id] : null;
  // Spielerbild: Foto, sonst Commander-Art des neuesten Decks, sonst Initialen
  const personAv = (m, size) => {
    const d = latest[m.id];
    return avatar({ name: memberName(m), url: urls[memberAvatarPath(m)] || d?.image_url || null, size, ring: !!d, color: d ? playerColor(d) : '' });
  };
  // eigenes Profil zuerst, dann alphabetisch
  members.sort((a, b) => (b.profile_id === me?.id) - (a.profile_id === me?.id) || memberName(a).localeCompare(memberName(b), 'de'));

  mount(el, html`
    <div class="top">
      <a class="group-switch" href="#/gruppen" aria-label="${t('home.switchGroup')}: ${g?.name}"><span>${g?.name}</span>${icon('chevDown', 18)}</a>
      <a href="#/profil" aria-label="${t('nav.me')}" class="avatar-link">${mine ? personAv(mine, 42) : avatar({ name: me?.display_name, url: urls[me?.avatar_path], size: 42 })}</a>
    </div>

    <div class="art-hero" ${myDeck?.image_url ? html`style="--art:url('${myDeck.image_url}')"` : ''}>
      ${myDeck?.image_url ? '' : html`<span class="art-credit">Command Tower · Arthur Yuan</span>`}
      <h2>${t('home.newRound')}</h2>
      <p>${t('home.newRoundSub')}</p>
      <div class="btns">
        <a class="btn" href="#/spielen">${icon('plus', 20)}${t('home.newGame')}</a>
        <button class="btn outline" type="button" data-act="live">${icon('live', 20)}${t('home.joinGame')}</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('home.players')}</h3><a href="#/gruppen">${t('home.all')}</a></div>
      <div class="people">
        ${members.map((m) => html`<a class="person" href="#/profil/${m.id}">${personAv(m, 54)}<span>${memberName(m)}</span></a>`)}
        <a class="person" href="#/spieler-neu"><span class="add">${icon('userPlus', 22)}</span><span>${t('home.addShort')}</span></a>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('home.leaderboard')}</h3></div>
      <div class="card">${empty('trophy', t('home.noGames'), t('home.noGamesSub'))}</div>
    </div>`);

  on(el, 'click', '[data-act="live"]', () => toast(t('home.joinSoon')));
}
