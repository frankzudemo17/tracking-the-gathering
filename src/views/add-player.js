// Spieler ohne Konto anlegen
import { sb, must } from '../supabase.js';
import { state } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { backHead } from '../lib/parts.js';
import { toast, errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

export default function addPlayer(el) {
  mount(el, html`
    ${backHead(t('addPlayer.title'), '#/gruppen')}
    <form class="form" novalidate>
      <div class="field"><label for="ap-name">${t('addPlayer.name')}</label>
        <input id="ap-name" class="input" autocomplete="off" maxlength="40" placeholder="${t('addPlayer.namePh')}" required></div>
      <div class="card soft">
        <b>${t('addPlayer.noAccount')}</b>
        <span class="small">${t('addPlayer.noAccountText')}</span>
      </div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('addPlayer.create')}</button>
    </form>`);

  on(el, 'submit', 'form', async (e) => {
    e.preventDefault();
    const err = el.querySelector('.error');
    const name = el.querySelector('#ap-name').value.trim();
    if (!name || name.length > 40) { err.textContent = t('auth.errors.name'); err.hidden = false; return; }
    await busy(el.querySelector('button[type=submit]'), async () => {
      try {
        const m = must(await sb.rpc('create_placeholder', { p_group: state.groupId, p_name: name }));
        toast(t('addPlayer.created', { name: m.display_name }));
        go(`/profil/${m.id}`, { replace: true });
      } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
    });
  });
}
