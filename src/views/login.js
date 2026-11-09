import { sb } from '../supabase.js';
import { pendingCode } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { manaPips } from '../lib/parts.js';
import { errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';

export function authHead(sub) {
  return html`<div class="auth-head">
    ${manaPips(undefined, 18)}
    <h1 class="auth-title">Tracking<br>the Gathering</h1>
    <p class="muted">${sub}</p>
  </div>`;
}

export const pendingNote = () => {
  const c = pendingCode.get();
  return c ? html`<p class="card soft small">${t('auth.pendingCode', { code: c })}</p>` : '';
};

export default function login(el) {
  el.classList.add('auth');
  mount(el, html`
    ${authHead(t('tagline'))}
    <form class="form" novalidate>
      ${pendingNote()}
      <div class="field"><label for="li-mail">${t('auth.email')}</label>
        <input id="li-mail" class="input" type="email" autocomplete="email" inputmode="email" placeholder="name@beispiel.de" required></div>
      <div class="field"><label for="li-pass">${t('auth.password')}</label>
        <input id="li-pass" class="input" type="password" autocomplete="current-password" placeholder="••••••••" required></div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('auth.login')}</button>
      <div class="auth-links">
        <a class="link" href="#/registrieren">${t('auth.register')}</a>
        <a class="link muted" href="#/passwort-vergessen">${t('auth.forgot')}</a>
      </div>
    </form>`);

  on(el, 'submit', 'form', async (e) => {
    e.preventDefault();
    const err = el.querySelector('.error');
    err.hidden = true;
    await busy(el.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.auth.signInWithPassword({
        email: el.querySelector('#li-mail').value.trim(),
        password: el.querySelector('#li-pass').value,
      });
      if (error) { err.textContent = errText(error); err.hidden = false; }
      // Erfolg: onAuthStateChange in main.js lädt das Profil und navigiert
    });
  });
}
