// Verwaltung für den Superadmin (Spec P9b F): Konten-Übersicht, Deckel, Gruppe erstellen.
// Die Sperre sitzt hier (nicht in render()): wer kein Superadmin ist, landet auf /einstellungen.
// Sicherheit liegt in der Datenbank (P9): access_overview und set_max_accounts lehnen alle anderen ab.
import { sb, must } from '../supabase.js';
import { isSuperadmin } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead } from '../lib/parts.js';
import { toast, errText } from '../lib/ui.js';
import { openNewGroup } from '../lib/group-actions.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';
import { MAX_MIN, MAX_MAX, parseMax } from '../zugang/limits.js';

export default async function admin(el, { isStale }) {
  if (!isSuperadmin()) { go('/einstellungen', { replace: true }); return; }
  let ov;
  try { ov = must(await sb.rpc('access_overview')); } catch (e) {
    if (isStale()) return;
    mount(el, html`${backHead(t('access.adminTitle'), '#/einstellungen')}<div class="empty"><b>${errText(e)}</b></div>`);
    return;
  }
  if (isStale()) return;
  const locked = ov.accounts >= ov.max_accounts;

  mount(el, html`
    ${backHead(t('access.adminTitle'), '#/einstellungen')}
    <div class="card admin-card" data-overview>
      <h3 class="section-title">${t('access.accountsTitle')}</h3>
      <p class="admin-count num" data-count>${t('access.accounts', { n: ov.accounts, max: ov.max_accounts })}</p>
      ${ov.unconfirmed ? html`<p class="hint" data-unconfirmed>${t('access.unconfirmed', { n: ov.unconfirmed })}</p>` : ''}
      ${locked ? html`<p class="note warn" role="status" data-locked>${icon('lock', 16)}<span>${t('access.locked')}</span></p>` : ''}
      <form class="form" novalidate data-form="max">
        <div class="field"><label for="ad-max">${t('access.capLabel')}</label>
          <input id="ad-max" class="input num" type="number" inputmode="numeric" min="${MAX_MIN}" max="${MAX_MAX}" step="1" value="${ov.max_accounts}" aria-describedby="ad-max-hint"></div>
        <span id="ad-max-hint" class="hint">${t('access.capHint')}</span>
        <p class="error" role="alert" hidden></p>
        <button class="btn block" type="submit">${t('access.capSave')}</button>
      </form>
    </div>

    <div class="card admin-card">
      <h3 class="section-title">${t('access.groupsTitle')}</h3>
      <button type="button" class="btn block soft" data-act="new">${icon('plus', 18)}${t('access.createGroup')}</button>
      <span class="hint">${t('access.groupsHint')}</span>
    </div>`);

  on(el, 'click', '[data-act="new"]', () => openNewGroup());
  on(el, 'submit', '[data-form="max"]', async (e, form) => {
    e.preventDefault();
    const err = form.querySelector('.error');
    err.hidden = true;
    const n = parseMax(form.querySelector('#ad-max').value);
    if (n === null) { err.textContent = t('auth.errors.max_accounts_range'); err.hidden = false; return; }
    await busy(form.querySelector('button[type=submit]'), async () => {
      try {
        must(await sb.rpc('set_max_accounts', { p_max: n }));
        toast(t('access.capSaved'));
        go('/einstellungen/verwaltung');
      } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
    });
  });
}
