// Erster Start ohne Playgroup
import { sb } from '../supabase.js';
import { state, pendingCode, isSuperadmin } from '../state.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openNewGroup, openEnterCode } from '../lib/group-actions.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';
import { authArt } from './login.js';

export default function welcome(el) {
  if (state.groupId) { go('/start', { replace: true }); return; }
  el.classList.add('auth');
  mount(el, html`
    ${authArt(t('welcome.title', { name: state.profile?.display_name || '' }), t('welcome.sub'))}
    <div class="form">
      <button class="btn block" type="button" data-act="code">${icon('key', 20)}${t('welcome.join')}</button>
      ${isSuperadmin() ? html`<button class="btn soft block" type="button" data-act="new">${icon('users', 20)}${t('welcome.create')}</button>` : ''}
    </div>
    <button class="btn danger" type="button" data-act="logout">${icon('logout', 18)}${t('profile.logout')}</button>`);
  on(el, 'click', '[data-act="new"]', () => { if (isSuperadmin()) openNewGroup(); });
  on(el, 'click', '[data-act="code"]', () => openEnterCode(pendingCode.get() || ''));
  on(el, 'click', '[data-act="logout"]', () => sb.auth.signOut());
}
