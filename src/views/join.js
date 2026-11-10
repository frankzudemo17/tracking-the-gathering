// Einladung per Link oder Code (Spec P9b C): #/beitreten, #/beitreten/:code und Alias #/code/:code.
// Ohne Anmeldung: Code prüfen (check_invite) ⇒ Einladung mit „Konto erstellen“ / „Ich habe schon ein Konto“,
// unbekannter Link oder volle Registrierung ⇒ passende Meldung. Mit Anmeldung: einlösen wie bisher code.js
// (Beitritt, sonst Übernahme eines Spielers ohne Konto).
import { sb } from '../supabase.js';
import { state, pendingCode } from '../state.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { loading } from '../lib/parts.js';
import { toast, errText } from '../lib/ui.js';
import { redeemCode, normCode, openEnterCode } from '../lib/group-actions.js';
import { checkInvite, codeFromInput } from '../zugang/invite.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';
import { authArt } from './login.js';

/** Feld „Code oder Link“ + Weiter ⇒ #/beitreten/<code> */
const codeForm = (value = '') => html`
  <form class="form auth-card" novalidate data-form="join-code">
    <div class="field"><label for="jn-code">${t('access.codeLabel')}</label>
      <input id="jn-code" class="input code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="200"
        placeholder="${t('groups.codePh')}" value="${value}"></div>
    <p class="error" role="alert" hidden></p>
    <button class="btn block" type="submit">${t('access.next')}${icon('arrowRight', 18)}</button>
  </form>`;

const haveAccount = html`<button class="btn block soft" type="button" data-act="have-account">${icon('signIn', 18)}${t('auth.haveAccount')}</button>`;

export default async function join(el, { params }) {
  const code = normCode(params.code);
  el.classList.add('auth');

  on(el, 'submit', '[data-form="join-code"]', (e, form) => {
    e.preventDefault();
    const c = normCode(codeFromInput(form.querySelector('#jn-code').value));
    const err = form.querySelector('.error');
    if (!c) { err.textContent = t('groups.codeWrong'); err.hidden = false; return; }
    go(`/beitreten/${encodeURIComponent(c)}`);
  });
  on(el, 'click', '[data-act="have-account"]', () => { if (code) pendingCode.set(code); go('/login'); });
  on(el, 'click', '[data-act="create-account"]', () => { pendingCode.set(code); go('/registrieren'); });
  on(el, 'click', '[data-act="retry"]', () => go(location.hash.slice(1)));

  // Ohne Code: nur das Feld
  if (!code) {
    mount(el, html`${authArt(t('access.enterTitle'), t('access.enterSub'))}${codeForm()}
      ${state.session ? '' : html`<div class="form">${haveAccount}</div>`}`);
    return;
  }

  // Mit Anmeldung: einlösen (Verhalten der früheren code.js)
  if (state.session) {
    mount(el, loading());
    try {
      const r = await redeemCode(code);
      pendingCode.clear();
      if (r.ok) { toast(r.message); go('/start', { replace: true }); return; }
      go(state.groupId ? '/gruppen' : '/willkommen', { replace: true });
      setTimeout(() => openEnterCode(code), 50);
      toast(r.message);
    } catch (e) {
      pendingCode.clear();
      mount(el, html`<div class="empty"><b>${errText(e)}</b><a class="btn soft" href="#/start">OK</a></div>`);
    }
    return;
  }

  // Ohne Anmeldung: Code prüfen
  mount(el, loading());
  let res;
  try {
    res = await checkInvite(sb, code);
  } catch (e) {
    mount(el, html`${authArt(t('access.joinTitle'), '')}
      <div class="form auth-card" data-state="error">
        <p class="error" role="alert">${errText(e)}</p>
        <button class="btn block" type="button" data-act="retry">${icon('arrowCounterClockwise', 18)}${t('common.reload')}</button>
        ${haveAccount}
      </div>`);
    return;
  }

  if (res.status === 'ok' || res.status === 'unknown') {
    mount(el, html`${authArt(res.group_name ? t('access.invited', { name: res.group_name }) : t('access.invitedNoName'), t('access.invitedSub'))}
      <div class="form auth-card" data-state="invite">
        <p class="code-chip"><span class="code">${code}</span></p>
        <button class="btn block" type="button" data-act="create-account">${icon('userPlus', 18)}${t('auth.register')}</button>
        ${haveAccount}
      </div>`);
    return;
  }
  if (res.status === 'full') {
    mount(el, html`${authArt(t('access.full'), t('access.fullSub'))}
      <div class="form auth-card" data-state="full">${haveAccount}</div>`);
    return;
  }
  // invalid
  mount(el, html`${authArt(t('access.joinTitle'), '')}
    <div class="form" data-state="invalid"><p class="note warn" role="alert">${t('access.invalid')}</p></div>
    ${codeForm(code)}
    <div class="form">${haveAccount}</div>`);
}
