// Verwaltung für den Superadmin (Spec P9b F): Konten-Übersicht, Deckel, Gruppe erstellen.
// Die Sperre sitzt hier (nicht in render()): wer kein Superadmin ist, landet auf /einstellungen.
// Sicherheit liegt in der Datenbank (P9): access_overview und set_max_accounts lehnen alle anderen ab.
import { sb, must } from '../supabase.js';
import { isSuperadmin, loadMe, setGroup } from '../state.js';
import { rpcOrUnavailable } from './member-remove.js';
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
  // P10 F: „Alle Gruppen“ — fehlt die RPC (vor db push) oder scheitert sie, bleibt der Rest der Seite
  let all = null, allErr = '';
  try {
    const r = await rpcOrUnavailable(sb, 'list_all_playgroups', {});
    if (r.unavailable) allErr = t('auth.errors.unavailable'); else all = must(r) || [];
  } catch (e) { allErr = errText(e); }
  if (isStale()) return;
  const locked = ov.accounts >= ov.max_accounts;
  const countText = (n) => (n === 1 ? t('groups.membersCountOne') : t('groups.membersCount', { n }));

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
    </div>

    <div class="card admin-card" data-all-groups>
      <h3 class="section-title">${t('access.allGroups')}</h3>
      ${allErr ? html`<p class="hint" data-all-error>${allErr}</p>`
        : all.length ? html`<div class="list">${all.map((gr) => html`
          <div class="row" data-group-row="${gr.id}">
            <span class="grow-col"><b>${gr.name}</b><span class="tiny muted">${countText(gr.members)}</span>
              ${gr.admins === 0 ? html`<span class="chip guest" data-no-admin>${icon('warn', 13)}${t('access.noAdmin')}</span>` : ''}</span>
            ${gr.is_member ? '' : html`<button type="button" class="btn small soft" data-act="enter" data-id="${gr.id}">${icon('signIn', 16)}${t('access.enter')}</button>`}
          </div>`)}</div>`
        : html`<p class="hint">${t('access.allNone')}</p>`}
    </div>`);

  on(el, 'click', '[data-act="new"]', () => openNewGroup());
  on(el, 'click', '[data-act="enter"]', async (e, b) => {
    const gr = (all || []).find((x) => x.id === b.dataset.id);
    if (!gr) return;
    await busy(b, async () => {
      try {
        const r = await rpcOrUnavailable(sb, 'enter_playgroup', { p_group: gr.id });
        if (r.unavailable) { toast(t('auth.errors.unavailable')); return; }
        must(r);
        await loadMe();
        setGroup(gr.id);
        toast(t('access.entered', { name: gr.name }));
        go('/gruppen');
      } catch (ex) { toast(errText(ex)); }
    });
  });
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
