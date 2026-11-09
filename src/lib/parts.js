// Wiederkehrende UI-Teile
import { html, initials } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n/index.js';

/** Runder Avatar: Foto, sonst Initialen. ring = Farbring (z. B. Spielerfarbe), color = CSS-Farbe. */
export function avatar({ name, url, size = 44, ring = false, color = '' }) {
  const style = `--av:${size}px;${color ? `--c:${color};` : ''}${url ? `background-image:url('${String(url).replace(/'/g, '%27')}');` : ''}`;
  return html`<span class="avatar ${ring ? 'ring' : ''}" style="${style}" aria-hidden="true">${url ? '' : initials(name)}</span>`;
}

export function backHead(title, href = '#/start') {
  return html`<div class="head">
    <a class="icon-btn" href="${href}" aria-label="${t('common.back')}">${icon('back', 20)}</a>
    ${title ? html`<h2>${title}</h2>` : ''}
  </div>`;
}

export const manaPips = (colors = ['W', 'U', 'B', 'R', 'G'], size = 12) =>
  html`<span class="pips" aria-hidden="true">${colors.map((c) => html`<span class="pip ${c}" style="width:${size}px;height:${size}px"></span>`)}</span>`;

export function empty(iconName, title, sub) {
  return html`<div class="empty"><span class="ic">${icon(iconName, 26)}</span><b>${title}</b>${sub ? html`<span>${sub}</span>` : ''}</div>`;
}

export const roleChip = (m) => {
  if (!m.profile_id) return html`<span class="chip guest">${t('groups.roles.guest')}</span>`;
  if (m.role === 'admin') return html`<span class="chip admin">${icon('shield', 13)}${t('groups.roles.admin')}</span>`;
  return html`<span class="chip">${t('groups.roles.member')}</span>`;
};

/** Anzeigename eines Mitglieds: bei Konten der Profilname, sonst der Platzhaltername */
export const memberName = (m) => m.profiles?.display_name || m.display_name;
export const memberAvatarPath = (m) => (m.profile_id ? m.profiles?.avatar_path : m.avatar_path) || null;

export function loading() { return html`<div class="loading" aria-label="${t('common.loading')}"><span class="spinner"></span></div>`; }
