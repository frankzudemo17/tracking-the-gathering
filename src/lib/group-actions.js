// Gruppen anlegen, Codes einlösen – genutzt von Willkommen, Playgroups und Code-Link
import { sb, must } from '../supabase.js';
import { state, loadMe, setGroup, pendingCode } from '../state.js';
import { html, on, busy } from './dom.js';
import { sheet, toast, errText } from './ui.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

export const normCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

/**
 * Löst einen Code ein. TTG-… zuerst als Einladung, sonst (oder wenn unbekannt) als
 * Spielercode. Gibt { ok, message } zurück.
 */
export async function redeemCode(raw) {
  const code = normCode(raw);
  if (!code) return { ok: false, message: t('groups.codeWrong') };
  if (code.startsWith('TTG-')) {
    const m = must(await sb.rpc('join_playgroup', { p_code: code }));
    if (m?.id) {
      await loadMe(); setGroup(m.playgroup_id);
      const g = state.memberships.find((x) => x.playgroup_id === m.playgroup_id)?.playgroups;
      return { ok: true, message: t('groups.joined', { name: g?.name || '' }) };
    }
  }
  const c = must(await sb.rpc('claim_member', { p_code: code }));
  if (c?.id) { await loadMe(); setGroup(c.playgroup_id); return { ok: true, message: t('groups.claimed') }; }
  return { ok: false, message: t('groups.codeWrong') };
}

export function openNewGroup() {
  sheet(t('groups.newGroup'), html`
    <h2>${t('groups.newGroup')}</h2>
    <form class="form" novalidate>
      <div class="field"><label for="ng-name">${t('groups.groupName')}</label>
        <input id="ng-name" class="input" maxlength="60" autocomplete="off" placeholder="${t('groups.groupNamePh')}" required></div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('groups.create')}</button>
    </form>`, (el, close) => {
    on(el, 'submit', 'form', async (e) => {
      e.preventDefault();
      const name = el.querySelector('#ng-name').value.trim();
      const err = el.querySelector('.error');
      if (!name) { err.textContent = t('groups.groupName'); err.hidden = false; return; }
      await busy(el.querySelector('button[type=submit]'), async () => {
        try {
          const g = must(await sb.rpc('create_playgroup', { p_name: name }));
          await loadMe(); setGroup(g.id); close(); toast(t('groups.created')); go('/gruppen');
        } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
      });
    });
  });
}

export function openEnterCode(prefill = '') {
  sheet(t('groups.enterCode'), html`
    <h2>${t('groups.enterCode')}</h2>
    <form class="form" novalidate>
      <div class="field"><label for="code-in">${t('groups.codeLabel')}</label>
        <input id="code-in" class="input code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="${t('groups.codePh')}" value="${prefill}"></div>
      <p class="hint">${t('groups.codeHint')}</p>
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('groups.redeem')}</button>
    </form>`, (el, close) => {
    on(el, 'submit', 'form', async (e) => {
      e.preventDefault();
      const err = el.querySelector('.error');
      await busy(el.querySelector('button[type=submit]'), async () => {
        try {
          const r = await redeemCode(el.querySelector('#code-in').value);
          if (!r.ok) { err.textContent = r.message; err.hidden = false; return; }
          pendingCode.clear(); close(); toast(r.message); go('/start');
        } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
      });
    });
  });
}
