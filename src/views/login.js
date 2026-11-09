import { sb } from '../supabase.js';
import { pendingCode } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';

/** Großes Bild oben mit Marke und Untertitel (Login, Registrieren, Willkommen) */
export function authArt(title, sub) {
  return html`<div class="auth-art">
    <div class="brand">
      <h1 class="auth-title">${title}</h1>
      ${sub ? html`<p class="auth-sub">${sub}</p>` : ''}
    </div>
  </div>`;
}
export const brandTitle = () => html`Tracking<br>the Gathering`;

export const pendingNote = () => {
  const c = pendingCode.get();
  return c ? html`<p class="note">${t('auth.pendingCode', { code: c })}</p>` : '';
};

export default function login(el) {
  el.classList.add('auth');
  mount(el, html`
    ${authArt(brandTitle(), t('tagline'))}
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
