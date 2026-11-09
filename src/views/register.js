import { sb } from '../supabase.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { authHead, pendingNote } from './login.js';

export default function register(el) {
  el.classList.add('auth');
  mount(el, html`
    ${authHead(t('auth.registerSub'))}
    <form class="form" novalidate>
      ${pendingNote()}
      <div class="field"><label for="rg-name">${t('auth.name')}</label>
        <input id="rg-name" class="input" autocomplete="nickname" maxlength="40" placeholder="${t('auth.namePh')}" required></div>
      <div class="field"><label for="rg-mail">${t('auth.email')}</label>
        <input id="rg-mail" class="input" type="email" autocomplete="email" inputmode="email" placeholder="name@beispiel.de" required></div>
      <div class="field"><label for="rg-pass">${t('auth.password')}</label>
        <input id="rg-pass" class="input" type="password" autocomplete="new-password" minlength="8" placeholder="••••••••" required aria-describedby="rg-pw-hint">
        <span id="rg-pw-hint" class="hint">${t('auth.pwHint')}</span></div>
      <p class="error" role="alert" hidden></p>
      <p class="card soft small" data-mail hidden>${t('auth.checkMail')}</p>
      <button class="btn block" type="submit">${t('auth.register')}</button>
      <div class="auth-links"><a class="link" href="#/login">${t('auth.haveAccount')}</a></div>
    </form>`);

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
