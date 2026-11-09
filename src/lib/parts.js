// Wiederkehrende UI-Teile
import { html, initials } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n/index.js';

export function avatar({ name, url, size = 44, plain = false }) {
  const style = `--av:${size}px;${url ? `background-image:url('${String(url).replace(/'/g, '%27')}');` : ''}`;
  return html`<span class="avatar ${plain ? 'plain' : ''}" style="${style}" aria-hidden="true">${url ? '' : initials(name)}</span>`;
}

export function backHead(title, href = '#/start') {
  return html`<div class="head">
    <a class="icon-btn" href="${href}" aria-label="${t('common.back')}">${icon('back')}</a>
    <h2>${title}</h2>
  </div>`;
}

export const manaPips = (colors = ['W', 'U', 'B', 'R', 'G'], size = 14) =>
  html`<span class="pips" aria-hidden="true">${colors.map((c) => html`<span class="pip ${c}" style="width:${size}px;height:${size}px"></span>`)}</span>`;

export function empty(iconName, title, sub) {
  return html`<div class="empty">${icon(iconName, 32, 1.6)}<b>${title}</b><span class="small">${sub}</span></div>`;
}

export const roleChip = (m) => {
  if (!m.profile_id) return html`<span class="chip guest">${t('groups.roles.guest')}</span>`;
  return html`<span class="chip ${m.role === 'admin' ? 'admin' : ''}">${t(`groups.roles.${m.role}`)}</span>`;
};

/** Anzeigename eines Mitglieds: bei Konten der Profilname, sonst der Platzhaltername */
export const memberName = (m) => m.profiles?.display_name || m.display_name;
export const memberAvatarPath = (m) => (m.profile_id ? m.profiles?.avatar_path : m.avatar_path) || null;

export function loading() { return html`<div class="loading" aria-label="${t('common.loading')}"><span class="spinner"></span></div>`; }
