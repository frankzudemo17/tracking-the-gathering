import { sb } from '../supabase.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { errText } from '../lib/ui.js';
import { backHead } from '../lib/parts.js';
import { t } from '../i18n/index.js';

export default function forgot(el) {
  mount(el, html`
    ${backHead(t('auth.forgotTitle'), '#/login')}
    <p class="muted">${t('auth.forgotSub')}</p>
    <form class="form" novalidate>
      <div class="field"><label for="fg-mail">${t('auth.email')}</label>
        <input id="fg-mail" class="input" type="email" autocomplete="email" inputmode="email" required></div>
      <p class="error" role="alert" hidden></p>
      <p class="card soft small" data-ok hidden>${t('auth.linkSent')}</p>
      <button class="btn block" type="submit">${t('auth.sendLink')}</button>
    </form>`);

  on(el, 'submit', 'form', async (e) => {
    e.preventDefault();
    const err = el.querySelector('.error');
    err.hidden = true;
    await busy(el.querySelector('button[type=submit]'), async () => {
      const u = new URL(location.href); u.hash = ''; u.search = '?reset=1';
      const { error } = await sb.auth.resetPasswordForEmail(el.querySelector('#fg-mail').value.trim(), { redirectTo: u.toString() });
      if (error) { err.textContent = errText(error); err.hidden = false; return; }
      el.querySelector('[data-ok]').hidden = false;
    });
  });
}
