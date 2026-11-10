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
    mount(b, icon(show ? 'eyeOff' : 'eye', 20));
  });
}

/** Ziel der Mail-Links: App-URL ohne Query und Hash (main.js räumt die Query nach der Rückkehr auf). */
export function mailRedirect() {
  const u = new URL(location.href); u.search = ''; u.hash = '';
  return u.toString();
}

/** Supabase-Fehler „E-Mail noch nicht bestätigt“ (Anmeldung mit richtigem Passwort, aber unbestätigt). */
export const isUnconfirmed = (error) => error?.code === 'email_not_confirmed' || /Email not confirmed/i.test(error?.message || '');

const RESEND_LOCK_S = 60;

/**
 * Knopf „Bestätigungsmail erneut senden“ (Registrieren und Anmelden): auth.resend(Typ signup) für die Adresse
 * aus getEmail(), danach 60 s gesperrt mit Restzeit im Knopf. Meldet Supabase selbst eine Wartezeit
 * („… after N seconds“), gilt diese. Die Sperre lebt nur in dieser Ansicht: Neuladen hebt sie auf, dann
 * drosselt Supabase selbst. Die Rückmeldung ist neutral und verrät nicht, ob es die Adresse gibt.
 * btn enthält <span data-label>, note = <p class="note">, err = <p class="error">.
 */
export function bindResend(btn, getEmail, { note, err }) {
  const label = btn.querySelector('[data-label]');
  const idle = label.textContent;
  let timer = null;
  const lock = (sec) => {
    clearInterval(timer);
    let left = sec;
    btn.disabled = true;
    const tick = () => {
      if (!btn.isConnected) { clearInterval(timer); return; } // Ansicht verlassen
      if (left <= 0) { clearInterval(timer); btn.disabled = false; label.textContent = idle; return; }
      label.textContent = t('auth.resendWait', { s: left });
      left -= 1;
    };
    tick();
    timer = setInterval(tick, 1000);
  };
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const email = String(getEmail() || '').trim();
    note.hidden = true; err.hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = t('account.emailBad'); err.hidden = false; return; }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    let error;
    try {
      ({ error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: mailRedirect() } }));
    } catch (ex) { error = ex; }
    btn.removeAttribute('aria-busy');
    if (!error) { note.textContent = t('auth.resendSent'); note.hidden = false; lock(RESEND_LOCK_S); return; }
    const wait = /after (\d+) seconds?/i.exec(error.message || '');
    if (wait || error.status === 429 || /rate limit/i.test(error.message || '')) {
      err.textContent = t('auth.errors.rate'); err.hidden = false;
      lock(wait ? Number(wait[1]) : RESEND_LOCK_S);
      return;
    }
    btn.disabled = false;
    err.textContent = errText(error); err.hidden = false;
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
      <p class="error" role="alert" hidden data-login-err></p>
      <div class="form" data-unconfirmed hidden>
        <p class="note" role="status" data-resend-note hidden></p>
        <p class="error" role="alert" data-resend-err hidden></p>
        <button class="btn block outline" type="button" data-act="resend">${icon('mail', 18)}<span data-label>${t('auth.resendLogin')}</span></button>
      </div>
      <button class="btn block" type="submit">${t('auth.login')}${icon('arrowRight', 18)}</button>
      <p class="auth-switch">${t('auth.noAccount')} <a class="link" href="#/registrieren">${t('auth.register')}</a></p>
    </form>`);

  bindPwToggles(el);
  const unconfirmed = el.querySelector('[data-unconfirmed]');
  bindResend(el.querySelector('[data-act="resend"]'), () => el.querySelector('#li-mail').value,
    { note: el.querySelector('[data-resend-note]'), err: el.querySelector('[data-resend-err]') });
  on(el, 'submit', 'form', async (e) => {
    e.preventDefault();
    const err = el.querySelector('[data-login-err]');
    err.hidden = true;
    unconfirmed.hidden = true;
    await busy(el.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.auth.signInWithPassword({
        email: el.querySelector('#li-mail').value.trim(),
        password: el.querySelector('#li-pass').value,
      });
      if (error) {
        err.textContent = isUnconfirmed(error) ? t('auth.errors.Email not confirmed') : errText(error);
        err.hidden = false;
        unconfirmed.hidden = !isUnconfirmed(error);
      }
      // Erfolg: onAuthStateChange in main.js lädt das Profil und navigiert
    });
  });
}
