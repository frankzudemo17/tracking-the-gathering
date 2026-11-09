import { sb } from '../supabase.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { errText, toast } from '../lib/ui.js';
import { backHead } from '../lib/parts.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

export default function newpass(el) {
  mount(el, html`
    ${backHead(t('auth.newPwTitle'), '#/start')}
    <form class="form" novalidate>
      <div class="field"><label for="np-pass">${t('auth.password')}</label>
        <input id="np-pass" class="input" type="password" autocomplete="new-password" minlength="8" required>
        <span class="hint">${t('auth.pwHint')}</span></div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('auth.newPwSave')}</button>
    </form>`);

  on(el, 'submit', 'form', async (e) => {
    e.preventDefault();
    const err = el.querySelector('.error');
    const password = el.querySelector('#np-pass').value;
    if (password.length < 8) { err.textContent = t('auth.errors.weak'); err.hidden = false; return; }
    await busy(el.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.auth.updateUser({ password });
      if (error) { err.textContent = errText(error); err.hidden = false; return; }
      toast(t('auth.newPwDone')); go('/start');
    });
  });
}
