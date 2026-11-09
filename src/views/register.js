import { sb } from '../supabase.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { authArt, brandTitle, pendingNote, authField, bindPwToggles } from './login.js';
import { icon } from '../lib/icons.js';

export default function register(el) {
  el.classList.add('auth');
  mount(el, html`
    ${authArt(brandTitle(), t('auth.registerSub'))}
    <form class="form auth-card" novalidate>
      ${pendingNote()}
      ${authField({ id: 'rg-name', label: t('auth.name'), iconName: 'person', autocomplete: 'nickname', placeholder: t('auth.namePh'), extra: 'maxlength="40"' })}
      ${authField({ id: 'rg-mail', label: t('auth.email'), type: 'email', iconName: 'mail', autocomplete: 'email', placeholder: 'name@beispiel.de', extra: 'inputmode="email"' })}
      ${authField({ id: 'rg-pass', label: t('auth.password'), type: 'password', iconName: 'lock', autocomplete: 'new-password', placeholder: '••••••••',
        extra: 'minlength="8" aria-describedby="rg-pw-hint"', hint: html`<span id="rg-pw-hint" class="hint">${t('auth.pwHint')}</span>` })}
      <p class="error" role="alert" hidden></p>
      <p class="note" data-mail hidden>${t('auth.checkMail')}</p>
      <button class="btn block" type="submit">${t('auth.register')}${icon('arrowRight', 18)}</button>
      <p class="auth-switch">${t('auth.haveAccountQ')} <a class="link" href="#/login">${t('auth.login')}</a></p>
    </form>`);
  bindPwToggles(el);

  on(el, 'submit', 'form', async (e) => {
    e.preventDefault();
    const err = el.querySelector('.error');
    err.hidden = true;
    const name = el.querySelector('#rg-name').value.trim();
    const password = el.querySelector('#rg-pass').value;
    if (!name || name.length > 40) { err.textContent = t('auth.errors.name'); err.hidden = false; return; }
    if (password.length < 8) { err.textContent = t('auth.errors.weak'); err.hidden = false; return; }
    await busy(el.querySelector('button[type=submit]'), async () => {
      const redirect = new URL(location.href); redirect.search = ''; redirect.hash = '';
      const { data, error } = await sb.auth.signUp({
        email: el.querySelector('#rg-mail').value.trim(), password,
        options: { data: { display_name: name }, emailRedirectTo: redirect.toString() },
      });
      if (error) { err.textContent = errText(error); err.hidden = false; return; }
      // Mit Bestätigungsmail gibt es noch keine Sitzung → Hinweis zeigen
      if (!data.session) el.querySelector('[data-mail]').hidden = false;
    });
  });
}
