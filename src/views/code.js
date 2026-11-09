// #/code/TTG-XXXXXX – Einladungs- oder Übernahme-Link
import { state, pendingCode } from '../state.js';
import { html, mount } from '../lib/dom.js';
import { loading } from '../lib/parts.js';
import { toast, errText } from '../lib/ui.js';
import { redeemCode, normCode, openEnterCode } from '../lib/group-actions.js';
import { go } from '../router.js';

export default async function code(el, { params }) {
  const c = normCode(params.code);
  if (!state.session) { pendingCode.set(c); go('/login', { replace: true }); return; }
  mount(el, loading());
  try {
    const r = await redeemCode(c);
    pendingCode.clear();
    if (r.ok) { toast(r.message); go('/start', { replace: true }); return; }
    go(state.groupId ? '/gruppen' : '/willkommen', { replace: true });
    setTimeout(() => openEnterCode(c), 50);
    toast(r.message);
  } catch (e) {
    pendingCode.clear();
    mount(el, html`<div class="empty"><b>${errText(e)}</b><a class="btn ghost" href="#/start">OK</a></div>`);
  }
}
