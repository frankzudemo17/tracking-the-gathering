// Startseite
import { state, currentGroup } from '../state.js';
import { avatarUrls } from '../supabase.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, manaPips, empty } from '../lib/parts.js';
import { toast } from '../lib/ui.js';
import { t } from '../i18n/index.js';

export default async function start(el, { isStale }) {
  const g = currentGroup();
  const me = state.profile;
  const urls = await avatarUrls([me?.avatar_path]);
  if (isStale()) return;

  mount(el, html`
    <div class="top">
      <div class="top-l">
        <span class="eyebrow">Tracking the Gathering</span>
        <a class="group-switch" href="#/gruppen" aria-label="${t('home.switchGroup')}: ${g?.name}">${g?.name}${icon('chevDown', 18)}</a>
      </div>
      <a href="#/profil" aria-label="${t('nav.me')}" class="avatar-link">${avatar({ name: me?.display_name, url: urls[me?.avatar_path], plain: true })}</a>
    </div>

    <div class="hero">
      ${manaPips()}
      <div><div class="big">${t('home.newRound')}</div><div class="sub">${t('home.newRoundSub')}</div></div>
      <div class="btns">
        <a class="btn" href="#/spielen">${icon('plus')}${t('home.newGame')}</a>
        <button class="btn outline" type="button" data-act="live">${icon('live', 18)}${t('home.joinGame')}</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><span class="label">${t('home.leaderboard')}</span></div>
      <div class="card">${empty('trophy', t('home.noGames'), t('home.noGamesSub'))}</div>
    </div>`);

  on(el, 'click', '[data-act="live"]', () => toast(t('home.joinSoon')));
}
