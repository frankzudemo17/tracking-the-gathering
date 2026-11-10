import { sb } from '../supabase.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { authArt, brandTitle, pendingNote, authField, bindPwToggles, bindResend, mailRedirect } from './login.js';
import { icon } from '../lib/icons.js';

/**
 * Zustand nach dem Registrieren MIT Bestätigungsmail (signUp ohne Sitzung): Adresse, „Mail erneut senden“
 * (60 s Sperre, bindResend) und Weg zur Anmeldung. Gleicher Text für neue und schon registrierte Adressen
 * (Supabase antwortet in beiden Fällen ohne Sitzung) ⇒ verrät nicht, ob es ein Konto gibt.
 */
function showConfirm(card, email) {
  mount(card, html`
    <div class="empty" data-confirm>
      <span class="ic">${icon('mail', 26)}</span>
      <b>${t('auth.confirmTitle')}</b>
      <span>${t('auth.confirmText', { email })}</span>
    </div>
    <p class="hint">${t('auth.confirmHint')}</p>
    <p class="note" role="status" data-resend-note hidden></p>
    <p class="error" role="alert" data-resend-err hidden></p>
    <button class="btn block outline" type="button" data-act="resend">${icon('mail', 18)}<span data-label>${t('auth.resend')}</span></button>
    <a class="btn block soft" href="#/login">${t('auth.toLogin')}</a>`);
  bindResend(card.querySelector('[data-act="resend"]'), () => email,
    { note: card.querySelector('[data-resend-note]'), err: card.querySelector('[data-resend-err]') });
  card.querySelector('[data-act="resend"]').focus();
}

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
      <button class="btn block" type="submit">${t('auth.register')}${icon('arrowRight', 18)}</button>
      <p class="auth-switch">${t('auth.haveAccountQ')} <a class="link" href="#/login">${t('auth.login')}</a></p>
    </form>`);
  bindPwToggles(el);

  on(el, 'submit', 'form', async (e, form) => {
    e.preventDefault();
    if (form.querySelector('[data-confirm]')) return;
    const err = el.querySelector('.error');
    err.hidden = true;
    const name = el.querySelector('#rg-name').value.trim();
    const email = el.querySelector('#rg-mail').value.trim();
    const password = el.querySelector('#rg-pass').value;
    if (!name || name.length > 40) { err.textContent = t('auth.errors.name'); err.hidden = false; return; }
    if (password.length < 8) { err.textContent = t('auth.errors.weak'); err.hidden = false; return; }
    await busy(el.querySelector('button[type=submit]'), async () => {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { display_name: name }, emailRedirectTo: mailRedirect() },
      });
      if (error) { err.textContent = errText(error); err.hidden = false; return; }
      // Mit Bestätigungsmail gibt es noch keine Sitzung → eigener Zustand „Bestätige deine E-Mail“.
      // Mit Sitzung (Bestätigung aus) navigiert onAuthStateChange in main.js wie bisher.
      if (!data.session) showConfirm(form, email);
    });
  });
}
