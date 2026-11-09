// Playgroups: wechseln, anlegen, Code einlösen, einladen, Mitglieder
import { sb, must, avatarUrls, appUrl } from '../supabase.js';
import { state, setGroup, currentGroup } from '../state.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, backHead, roleChip, memberName, memberAvatarPath } from '../lib/parts.js';
import { copyText } from '../lib/ui.js';
import { openNewGroup, openEnterCode } from '../lib/group-actions.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

export const MEMBER_SELECT = '*, profiles!members_profile_id_fkey(display_name, avatar_path)';

export default async function groups(el, { isStale }) {
  const ids = state.memberships.map((m) => m.playgroup_id);
  const [counts, members] = await Promise.all([
    ids.length ? sb.from('members').select('playgroup_id, profile_id').in('playgroup_id', ids).then(must) : [],
    state.groupId ? sb.from('members').select(MEMBER_SELECT).eq('playgroup_id', state.groupId).order('created_at').then(must) : [],
  ]);
  const urls = await avatarUrls(members.map(memberAvatarPath));
  if (isStale()) return;

  const sub = (gid) => {
    const rows = counts.filter((c) => c.playgroup_id === gid);
    const guests = rows.filter((r) => !r.profile_id).length;
    return guests ? t('groups.membersCountGuests', { n: rows.length, g: guests }) : rows.length === 1 ? t('groups.membersCountOne') : t('groups.membersCount', { n: rows.length });
  };
  const g = currentGroup();
  // Admins zuerst, dann Mitglieder, dann Spieler ohne Konto; jeweils alphabetisch
  const rank = (m) => (!m.profile_id ? 2 : m.role === 'admin' ? 0 : 1);
  members.sort((a, b) => rank(a) - rank(b) || memberName(a).localeCompare(memberName(b), 'de'));

  mount(el, html`
    ${backHead(t('groups.title'), state.groupId ? '#/start' : '#/willkommen')}
    <div class="section">
      ${state.memberships.map((m) => html`
        <button type="button" class="pick" data-group="${m.playgroup_id}" aria-pressed="${m.playgroup_id === state.groupId}">
          <span class="grow-col"><b>${m.playgroups.name}</b><span class="tiny muted">${sub(m.playgroup_id)}</span></span>
          ${m.playgroup_id === state.groupId ? html`<span class="accent-text">${icon('check', 20, 2.2)}</span>` : ''}
        </button>`)}
      <div class="two">
        <button type="button" class="btn dashed" data-act="new">${icon('plus', 18)}${t('groups.newGroup')}</button>
        <button type="button" class="btn dashed" data-act="code">${icon('key', 18)}${t('groups.enterCode')}</button>
      </div>
    </div>

    ${g ? html`
    <div class="card">
      <span class="label">${t('groups.invite')} · ${g.name}</span>
      <div class="code-row">
        <span class="code">${g.invite_code}</span>
        <button type="button" class="btn ghost small" data-act="copy">${icon('copy', 16)}${t('groups.copy')}</button>
      </div>
      <button type="button" class="btn ghost small" data-act="share">${icon('share', 16)}${t('groups.copyLink')}</button>
      <span class="hint">${t('groups.inviteHint')}</span>
    </div>

    <div class="section">
      <span class="label">${t('groups.members')}</span>
      <div class="list">
        ${members.map((m) => html`
          <a class="row" href="#/profil/${m.id}">
            ${avatar({ name: memberName(m), url: urls[memberAvatarPath(m)], size: 36, plain: true })}
            <span class="grow"><span class="title">${memberName(m)}${m.profile_id === state.profile?.id ? html` <span class="muted">·</span> <span class="muted tiny">ich</span>` : ''}</span></span>
            ${roleChip(m)}
          </a>`)}
      </div>
      <a class="btn dashed" href="#/spieler-neu">${icon('plus', 18)}${t('groups.addPlaceholder')}</a>
      <span class="hint">${t('groups.addPlaceholderHint')}</span>
    </div>` : ''}`);

  on(el, 'click', '[data-group]', (e, b) => { setGroup(b.dataset.group); go('/gruppen'); });
  on(el, 'click', '[data-act="new"]', () => openNewGroup());
  on(el, 'click', '[data-act="code"]', () => openEnterCode());
  on(el, 'click', '[data-act="copy"]', () => copyText(g.invite_code));
  on(el, 'click', '[data-act="share"]', async () => {
    const url = appUrl(`#/code/${g.invite_code}`);
    const text = t('groups.shareText', { name: g.name });
    if (navigator.share) { try { await navigator.share({ title: 'Tracking the Gathering', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copyText(url);
  });
}
