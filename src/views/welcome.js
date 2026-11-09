// Erster Start ohne Playgroup
import { state, pendingCode } from '../state.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { manaPips } from '../lib/parts.js';
import { openNewGroup, openEnterCode } from '../lib/group-actions.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

export default function welcome(el) {
  if (state.groupId) { go('/start', { replace: true }); return; }
  mount(el, html`
    <div class="auth-head">
      ${manaPips(undefined, 18)}
      <h1 class="auth-title">${t('welcome.title', { name: state.profile?.display_name || '' })}</h1>
      <p class="muted">${t('welcome.sub')}</p>
    </div>
    <div class="hero">
      <span class="big">${t('groups.title')}</span>
      <div class="btns">
        <button class="btn" type="button" data-act="new">${icon('plus')}${t('welcome.create')}</button>
        <button class="btn outline" type="button" data-act="code">${icon('key', 18)}${t('welcome.join')}</button>
      </div>
    </div>
    <button class="btn danger" type="button" data-act="logout">${icon('logout', 18)}${t('profile.logout')}</button>`);
  on(el, 'click', '[data-act="new"]', () => openNewGroup());
  on(el, 'click', '[data-act="code"]', () => openEnterCode(pendingCode.get() || ''));
  on(el, 'click', '[data-act="logout"]', async () => { const { sb } = await import('../supabase.js'); sb.auth.signOut(); });
}
