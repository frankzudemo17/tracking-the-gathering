// Toast, Bottom-Sheet, Fehlertexte
import { html, mount, $ } from './dom.js';
import { t } from '../i18n/index.js';

let toastTimer;
export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  mount(el, html`<span>${msg}</span>`);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/**
 * Öffnet ein Bottom-Sheet. content: html``-Ergebnis. onMount(sheetEl, close) bindet Events.
 * Gibt close() zurück. Escape und Tippen auf den Hintergrund schließen.
 */
export function sheet(label, content, onMount) {
  const prevFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  mount(wrap, html`<button type="button" class="scrim" aria-label="${t('common.close')}"></button>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${label}"><span class="grip"></span>${content}</div>`);
  document.body.append(wrap);
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  wrap.querySelector('.scrim').addEventListener('click', close);
  const sh = wrap.querySelector('.sheet');
  onMount?.(sh, close);
  const first = sh.querySelector('input:not([type=file]), button, label');
  first?.focus?.();
  return close;
}

/** Supabase-/Netzfehler in einen verständlichen Satz übersetzen. */
export function errText(e) {
  const m = e?.message || String(e || '');
  if (!navigator.onLine || /Failed to fetch|NetworkError/i.test(m)) return t('auth.errors.offline');
  const known = t(`auth.errors.${m}`);
  if (known !== `auth.errors.${m}`) return known;
  if (/rate limit|Zu viele/i.test(m)) return /Zu viele/.test(m) ? m : t('auth.errors.rate');
  if (/Password should be/i.test(m)) return t('auth.errors.weak');
  // Eigene Meldungen aus den RPCs sind schon deutsch und verständlich
  if (/^(Nicht angemeldet|Kein Mitglied|Name muss|Nur Admins|Die Gruppe braucht|Spieler ohne Konto)/.test(m)) return m;
  console.error(e);
  return t('auth.errors.generic');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t('groups.copied')); return true; }
  catch { prompt('', text); return false; }
}
