// Einladungs-Karte der Gruppenseite (Spec P9b E/G): Link teilen, QR-Sheet, Link erneuern.
// Kanonischer Link: #/beitreten/<code>. Der QR-Code trägt genau denselben Link wie „Link teilen“.
import { sb, must, appUrl } from '../supabase.js';
import { html, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { sheet, toast, errText, copyText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';
import { qrSvg } from './qr.js';

/** Einladungslink einer Gruppe (absolute Adresse der App). */
export const inviteLink = (code) => appUrl(`#/beitreten/${encodeURIComponent(code)}`);

/** Web Share mit Rückfall Kopieren. */
export async function shareInvite(g, code) {
  const url = inviteLink(code);
  const text = t('groups.shareText', { name: g.name });
  if (navigator.share) { try { await navigator.share({ title: 'Tracking the Gathering', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copyText(url);
}

/** Sheet mit QR-Code (immer schwarz auf weiß), Gruppenname, Code und „Link teilen“. */
export function openInviteQr(g, code) {
  const url = inviteLink(code);
  sheet(t('groups.qrTitle', { name: g.name }), html`
    <h2 class="sheet-title">${t('groups.qrTitle', { name: g.name })}</h2>
    <div class="qr-box" data-qr data-link="${url}">${qrSvg(url, { size: 264, label: t('groups.qrAlt', { name: g.name }) })}</div>
    <p class="qr-code"><span class="code">${code}</span></p>
    <p class="hint center">${t('groups.qrHint')}</p>
    <button type="button" class="btn block" data-act="qr-share">${icon('share', 18)}${t('groups.shareLink')}</button>`, (sh) => {
    on(sh, 'click', '[data-act="qr-share"]', () => shareInvite(g, code));
  });
}

/** Bestätigung „Link erneuern“ ⇒ renew_invite ⇒ Gruppenseite neu zeichnen. */
export function openRenew(g) {
  sheet(t('groups.renewTitle'), html`
    <h2 class="sheet-title">${t('groups.renewTitle')}</h2>
    <p class="sheet-text">${t('groups.renewText')}</p>
    <p class="error" role="alert" hidden></p>
    <button type="button" class="btn block" data-act="renew-yes">${icon('arrowCounterClockwise', 18)}${t('groups.renewYes')}</button>
    <button type="button" class="btn block soft" data-act="cancel">${t('common.cancel')}</button>`, (sh, close) => {
    on(sh, 'click', '[data-act="cancel"]', () => close());
    on(sh, 'click', '[data-act="renew-yes"]', async (e, b) => {
      const box = sh.querySelector('.error');
      await busy(b, async () => {
        try {
          must(await sb.rpc('renew_invite', { p_group: g.id }));
          close(); toast(t('groups.renewed')); go('/gruppen');
        } catch (ex) { box.textContent = errText(ex); box.hidden = false; }
      });
    });
  });
}
