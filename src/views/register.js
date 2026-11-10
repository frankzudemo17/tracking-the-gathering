import { sb } from '../supabase.js';
import { pendingCode } from '../state.js';
import { html, mount, on, busy, esc } from '../lib/dom.js';
import { errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { authArt, brandTitle, authField, bindPwToggles, bindResend, mailRedirect } from './login.js';
import { icon } from '../lib/icons.js';
import { normCode } from '../lib/group-actions.js';
import { checkInvite, codeFromInput } from '../zugang/invite.js';

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

/** Zustand „alle Plätze vergeben“: Formular gesperrt, Weg zur Anmeldung bleibt (Spec P9b D). */
function showFull(form) {
  mount(form, html`
    <div class="empty" data-state="full">
      <span class="ic">${icon('prohibit', 26)}</span>
      <b>${t('access.full')}</b>
      <span>${t('access.fullSub')}</span>
    </div>
    <a class="btn block soft" href="#/login">${t('auth.haveAccount')}</a>`);
}

export default function register(el) {
  el.classList.add('auth');
  const pre = pendingCode.get() || '';
  mount(el, html`
    ${authArt(brandTitle(), t('auth.registerSub'))}
    <form class="form auth-card" novalidate>
      ${authField({ id: 'rg-code', label: t('auth.inviteCode'), iconName: 'key', autocomplete: 'off', placeholder: t('groups.codePh'),
        extra: `maxlength="200" autocapitalize="characters" spellcheck="false" value="${esc(pre)}" aria-describedby="rg-code-hint"`,
        hint: html`<span id="rg-code-hint" class="hint">${t('auth.inviteCodeHint')}</span><p class="error" role="alert" hidden data-code-err></p><p class="note" role="status" hidden data-code-ok></p>` })}
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
    const err = el.querySelector('.error:not([data-code-err])');
    const codeErr = el.querySelector('[data-code-err]');
    const codeOk = el.querySelector('[data-code-ok]');
    err.hidden = true; codeErr.hidden = true;
    const code = normCode(codeFromInput(el.querySelector('#rg-code').value));
    const name = el.querySelector('#rg-name').value.trim();
    const email = el.querySelector('#rg-mail').value.trim();
    const password = el.querySelector('#rg-pass').value;
    const fieldErr = (msg) => { codeErr.textContent = msg; codeErr.hidden = false; codeOk.hidden = true; el.querySelector('#rg-code').focus(); };
    if (!code) { fieldErr(t('auth.errors.signup_code_required')); return; }
    if (!name || name.length > 40) { err.textContent = t('auth.errors.name'); err.hidden = false; return; }
    if (password.length < 8) { err.textContent = t('auth.errors.weak'); err.hidden = false; return; }
    await busy(el.querySelector('button[type=submit]'), async () => {
      // Erst prüfen (spart eine Registrierung, die das Tor ohnehin ablehnt), dann registrieren
      let check;
      try { check = await checkInvite(sb, code); } catch (ex) { err.textContent = errText(ex); err.hidden = false; return; }
      if (check.status === 'invalid') { fieldErr(t('auth.errors.signup_code_invalid')); return; }
      if (check.status === 'full') { showFull(form); return; }
      if (check.group_name) { codeOk.textContent = t('auth.joining', { name: check.group_name }); codeOk.hidden = false; }
      pendingCode.set(code); // nach der Sitzung löst join.js ein (alte DB: Beitritt; neue DB: schon Mitglied)
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { display_name: name, invite_code: code }, emailRedirectTo: mailRedirect() },
      });
      if (error) {
        // Das Tor meldet GoTrue nur als „Database error saving new user“ ⇒ erneut prüfen, was los ist
        if (/Database error saving new user/i.test(error.message || '')) {
          const again = await checkInvite(sb, code).catch(() => null);
          if (again?.status === 'full') { showFull(form); return; }
          if (again?.status === 'invalid') { fieldErr(t('auth.errors.signup_code_invalid')); return; }
        }
        err.textContent = errText(error); err.hidden = false; return;
      }
      // Mit Bestätigungsmail gibt es noch keine Sitzung → eigener Zustand „Bestätige deine E-Mail“.
      // Mit Sitzung (Bestätigung aus) navigiert onAuthStateChange in main.js wie bisher.
      if (!data.session) showConfirm(form, email);
    });
  });
}
