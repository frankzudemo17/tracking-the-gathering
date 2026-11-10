// Spieler ohne Konto anlegen
import { sb, must } from '../supabase.js';
import { state } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { backHead } from '../lib/parts.js';
import { toast, errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

// Rückweg ins Setup (Spec P7): #/…?zurueck=setup — der Router ignoriert den Query-Teil.
const fromSetup = () => new URLSearchParams(location.hash.split('?')[1] || '').get('zurueck') === 'setup';

export default function addPlayer(el) {
  const back = fromSetup();
  mount(el, html`
    ${backHead(t('addPlayer.title'), back ? '#/spiel-neu' : '#/gruppen')}
    <form class="form" novalidate>
      <div class="field"><label for="ap-name">${t('addPlayer.name')}</label>
        <input id="ap-name" class="input" autocomplete="off" maxlength="40" placeholder="${t('addPlayer.namePh')}" required></div>
      <div class="note">
        <b>${t('addPlayer.noAccount')}</b>
        <p class="small muted" style="margin-top:4px">${t('addPlayer.noAccountText')}</p>
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
        go(back ? `/spiel-neu?spieler=${m.id}` : `/profil/${m.id}`, { replace: true });
      } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
    });
  });
}
