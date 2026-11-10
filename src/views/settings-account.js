// Einstellungen → Konto: Passwort ändern, E-Mail ändern, Konto löschen (#/einstellungen/konto)
import { sb, appUrl } from '../supabase.js';
import { state } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead } from '../lib/parts.js';
import { toast, sheet, errText } from '../lib/ui.js';
import { t, getLang } from '../i18n/index.js';
import { authField, bindPwToggles } from './login.js';
import { passwordProblem, emailProblem, deleteConfirmed, runAccountDeletion, DELETE_WORD } from './settings-rules.js';

const showErr = (box, msg) => { box.textContent = msg; box.hidden = !msg; };

/**
 * Konto löschen: Probelauf → Dateien → RPC (runAccountDeletion, Begründung dort), dann lokal
 * abmelden (die Server-Sitzung gibt es mit dem Konto nicht mehr).
 */
export async function deleteAccount() {
  await runAccountDeletion(sb);
  try {
    for (const k of Object.keys(localStorage)) if (k === 'ttg.group' || k.startsWith('ttg.queue.')) localStorage.removeItem(k);
  } catch { /* privat */ }
  await sb.auth.signOut({ scope: 'local' });
}

function openDelete() {
  const lang = getLang();
  const word = DELETE_WORD[lang] || DELETE_WORD.de;
  sheet(t('account.deleteTitle'), html`
    <h2 class="sheet-title">${t('account.deleteTitle')}</h2>
    <ul class="facts">
      <li>${icon('trash', 18)}<span>${t('account.deleteGone')}</span></li>
      <li>${icon('users', 18)}<span>${t('account.deleteKept')}</span></li>
      <li>${icon('shield', 18)}<span>${t('account.deleteSolo')}</span></li>
    </ul>
    <form class="form" novalidate data-form="delete">
      <div class="field"><label for="del-word">${t('account.deleteType', { word })}</label>
        <input id="del-word" class="input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${word}"></div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block danger-fill" type="submit" disabled data-act="delete-yes">${icon('trash', 18)}${t('account.deleteYes')}</button>
      <button class="btn block soft" type="button" data-act="cancel">${t('common.cancel')}</button>
    </form>`, (sh, close) => {
    const input = sh.querySelector('#del-word');
    const yes = sh.querySelector('[data-act="delete-yes"]');
    const box = sh.querySelector('.error');
    let running = false;
    input.addEventListener('input', () => { yes.disabled = running || !deleteConfirmed(input.value, lang); });
    on(sh, 'click', '[data-act="cancel"]', () => { if (!running) close(); });
    on(sh, 'submit', 'form', async (e) => {
      e.preventDefault();
      if (running || !deleteConfirmed(input.value, lang)) return;
      running = true;
      showErr(box, '');
      sh.setAttribute('aria-busy', 'true');
      try {
        await busy(yes, deleteAccount);
        close();
        toast(t('account.deleted'));
      } catch (ex) {
        running = false;
        sh.removeAttribute('aria-busy');
        yes.disabled = !deleteConfirmed(input.value, lang);
        showErr(box, errText(ex));
      }
    });
  });
}

export default function settingsAccount(el) {
  const email = state.session?.user?.email || '';
  mount(el, html`
    ${backHead(t('account.title'), '#/einstellungen')}
    ${email ? html`<p class="muted small">${t('account.signedInAs', { email })}</p>` : ''}

    <form class="card form" novalidate data-form="pw">
      <h3 class="section-title">${t('account.pwTitle')}</h3>
      ${authField({ id: 'pw-new', label: t('account.pwNew'), type: 'password', iconName: 'lock', autocomplete: 'new-password', extra: 'minlength="8"', hint: html`<span class="hint">${t('auth.pwHint')}</span>` })}
      ${authField({ id: 'pw-repeat', label: t('account.pwRepeat'), type: 'password', iconName: 'lock', autocomplete: 'new-password', extra: 'minlength="8"' })}
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('account.pwSave')}</button>
    </form>

    <form class="card form" novalidate data-form="email">
      <h3 class="section-title">${t('account.emailTitle')}</h3>
      ${authField({ id: 'em-new', label: t('account.emailNew'), type: 'email', iconName: 'mail', autocomplete: 'email', placeholder: 'name@beispiel.de' })}
      <p class="hint">${t('account.emailHint')}</p>
      <p class="error" role="alert" hidden></p>
      <p class="note" data-sent hidden>${t('account.emailSent')}</p>
      <button class="btn block outline" type="submit">${t('account.emailSave')}</button>
    </form>

    <div class="card danger-zone">
      <div class="grow-col"><h3 class="section-title">${t('account.dangerTitle')}</h3><span class="hint">${t('account.dangerSub')}</span></div>
      <button class="btn block danger-outline" type="button" data-act="delete">${icon('trash', 18)}${t('account.delete')}</button>
    </div>`);

  bindPwToggles(el);

  on(el, 'submit', '[data-form="pw"]', async (e, form) => {
    e.preventDefault();
    const box = form.querySelector('.error');
    const pw = form.querySelector('#pw-new').value;
    const problem = passwordProblem(pw, form.querySelector('#pw-repeat').value);
    if (problem) { showErr(box, t(problem)); return; }
    showErr(box, '');
    await busy(form.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { showErr(box, /should be different/i.test(error.message || '') ? t('account.pwSame') : errText(error)); return; }
      form.reset();
      toast(t('account.pwDone'));
    });
  });

  on(el, 'submit', '[data-form="email"]', async (e, form) => {
    e.preventDefault();
    const box = form.querySelector('.error');
    const sent = form.querySelector('[data-sent]');
    const next = form.querySelector('#em-new').value.trim();
    const problem = emailProblem(next, email);
    sent.hidden = true;
    if (problem) { showErr(box, t(problem)); return; }
    showErr(box, '');
    await busy(form.querySelector('button[type=submit]'), async () => {
      const { error } = await sb.auth.updateUser({ email: next }, { emailRedirectTo: appUrl('#/einstellungen/konto') });
      if (error) { showErr(box, errText(error)); return; }
      sent.hidden = false;
      toast(t('account.emailSent'));
    });
  });

  on(el, 'click', '[data-act="delete"]', () => openDelete());
}
