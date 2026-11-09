import { sb } from '../supabase.js';
import { pendingCode } from '../state.js';
import { html, raw, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';

/** Bild oben, darauf mittig Logo, Schriftzug und Untertitel (Login, Registrieren, Willkommen) */
export function authArt(title, sub) {
  return html`<div class="auth-art">
    <div class="brand">
      <span class="auth-logo" aria-hidden="true"></span>
      <h1 class="auth-title">${title}</h1>
      ${sub ? html`<p class="auth-sub">${sub}</p>` : ''}
    </div>
  </div>`;
}
/** Schriftzug „Tracking the Gathering“ mit kleinem „the“ */
export const brandTitle = () => html`Tracking<br><span class="the">the</span> Gathering`;

/** Eingabefeld mit Symbol links; bei Passwort ein Auge zum Anzeigen. extra = feste Attribute aus dem Code */
export function authField({ id, label, type = 'text', iconName, autocomplete, placeholder = '', extra = '', hint = '' }) {
  const isPw = type === 'password';
  return html`<div class="field">
    <label for="${id}">${label}</label>
    <div class="input-icon">
      ${icon(iconName, 20)}
      <input id="${id}" class="input" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}" ${raw(extra)} required>
      ${isPw ? html`<button type="button" class="pw-toggle" data-pw="${id}" aria-label="${t('auth.showPw')}" aria-pressed="false">${icon('eye', 20)}</button>` : ''}
    </div>
    ${hint}
  </div>`;
}

/** Auge-Knopf: Passwort zeigen/verbergen */
export function bindPwToggles(el) {
  on(el, 'click', '.pw-toggle', (e, b) => {
    const input = el.querySelector(`#${b.dataset.pw}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? t('auth.hidePw') : t('auth.showPw'));
    b.innerHTML = String(icon(show ? 'eyeOff' : 'eye', 20));
  });
}

export const pendingNote = () => {
  const c = pendingCode.get();
  return c ? html`<p class="note">${t('auth.pendingCode', { code: c })}</p>` : '';
};

export default function login(el) {
  el.classList.add('auth');
  mount(el, html`
    ${authArt(brandTitle(), t('tagline'))}
    <form class="form auth-card" novalidate>
      ${pendingNote()}
      ${authField({ id: 'li-mail', label: t('auth.email'), type: 'email', iconName: 'mail', autocomplete: 'email', placeholder: 'name@beispiel.de', extra: 'inputmode="email"' })}
      ${authField({ id: 'li-pass', label: t('auth.password'), type: 'password', iconName: 'lock', autocomplete: 'current-password', placeholder: '••••••••',
        hint: html`<a class="link muted forgot" href="#/passwort-vergessen">${t('auth.forgot')}?</a>` })}
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('auth.login')}${icon('arrowRight', 18)}</button>
      <p class="auth-switch">${t('auth.noAccount')} <a class="link" href="#/registrieren">${t('auth.register')}</a></p>
    </form>`);

  bindPwToggles(el);
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
