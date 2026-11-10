// Playgroups: wechseln, anlegen, Code einlösen, einladen, Mitglieder, Gruppe löschen (nur Admin)
import { sb, must, avatarUrls } from '../supabase.js';
import { state, setGroup, currentGroup, isAdmin, isSuperadmin, loadMe } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, backHead, roleChip, memberName, memberAvatarPath } from '../lib/parts.js';
import { copyText, sheet, toast, errText } from '../lib/ui.js';
import { openNewGroup, openEnterCode } from '../lib/group-actions.js';
import { groupNameMatches, runGroupDeletion } from './group-delete.js';
import { inviteCode } from '../zugang/invite.js';
import { shareInvite, openInviteQr, openRenew } from '../zugang/invite-ui.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

export const MEMBER_SELECT = '*, profiles!members_profile_id_fkey(display_name, avatar_path)';

// ---------------------------------------------------------------- Gruppe löschen (Spec P3 Block A)
// Ablauf ohne DOM in group-delete.js (Unit-Test); hier nur das Sheet.

const deleteErrText = (e) => {
  const m = e?.message || '';
  if (/deck_used_elsewhere/.test(m)) return t('groups.deleteDeckElsewhere');
  if (/member_used_elsewhere/.test(m)) return t('groups.deleteMemberElsewhere');
  if (/Name stimmt nicht/.test(m)) return t('groups.deleteNameWrong');
  return errText(e);
};
const plural = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));

function openDeleteGroup(g, { games, members, guests }) {
  const warn = t('groups.deleteWarn', {
    games: plural(games, 'groups.deleteGamesOne', 'groups.deleteGames'),
    members: plural(members, 'groups.deleteMembersOne', 'groups.deleteMembers'),
    guests: plural(guests, 'groups.deleteGuestsOne', 'groups.deleteGuests'),
  });
  sheet(t('groups.deleteTitle', { name: g.name }), html`
    <h2 class="sheet-title">${t('groups.deleteTitle', { name: g.name })}</h2>
    <ul class="facts">
      <li>${icon('trash', 18)}<span data-warn>${warn}</span></li>
      <li>${icon('users', 18)}<span>${t('groups.deleteKept')}</span></li>
    </ul>
    <form class="form" novalidate data-form="delete-group">
      <div class="field"><label for="dg-name">${t('groups.deleteType')}</label>
        <input id="dg-name" class="input" type="text" autocomplete="off" spellcheck="false" maxlength="80" placeholder="${g.name}"></div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block danger-fill" type="submit" disabled data-act="delete-group-yes">${icon('trash', 18)}${t('groups.deleteYes')}</button>
      <button class="btn block soft" type="button" data-act="cancel">${t('common.cancel')}</button>
    </form>`, (sh, close) => {
    const input = sh.querySelector('#dg-name');
    const yes = sh.querySelector('[data-act="delete-group-yes"]');
    const box = sh.querySelector('.error');
    let running = false;
    const showErr = (msg) => { box.textContent = msg; box.hidden = !msg; };
    input.addEventListener('input', () => { yes.disabled = running || !groupNameMatches(input.value, g.name); });
    on(sh, 'click', '[data-act="cancel"]', () => { if (!running) close(); });
    on(sh, 'submit', 'form', async (e) => {
      e.preventDefault();
      if (running || !groupNameMatches(input.value, g.name)) return;
      running = true;
      input.readOnly = true;
      showErr('');
      sh.setAttribute('aria-busy', 'true');
      try {
        await busy(yes, () => runGroupDeletion(sb, g, input.value));
        await loadMe();
        setGroup(state.groupId); // Merker in localStorage nie auf der gelöschten Gruppe lassen
        close();
        toast(t('groups.deleted', { name: g.name }));
        go(state.groupId ? '/start' : '/willkommen', { replace: true });
      } catch (ex) {
        running = false;
        input.readOnly = false;
        sh.removeAttribute('aria-busy');
        yes.disabled = !groupNameMatches(input.value, g.name);
        showErr(deleteErrText(ex));
      }
    });
  });
}

export default async function groups(el, { isStale }) {
  const ids = state.memberships.map((m) => m.playgroup_id);
  const [counts, members] = await Promise.all([
    ids.length ? sb.from('members').select('playgroup_id, profile_id').in('playgroup_id', ids).then(must) : [],
    state.groupId ? sb.from('members').select(MEMBER_SELECT).eq('playgroup_id', state.groupId).order('created_at').then(must) : [],
  ]);
  const urls = await avatarUrls(members.map(memberAvatarPath));
  // Einladungscode nur für Admins der Gruppe und den Superadmin (Mitglieder fragen gar nicht erst)
  const code = currentGroup() && (isAdmin() || isSuperadmin()) ? await inviteCode(sb, currentGroup()) : null;
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
          ${m.playgroup_id === state.groupId ? html`<span class="ok">${icon('check', 22)}</span>` : ''}
        </button>`)}
      <div class="${isSuperadmin() ? 'two' : ''}">
        ${isSuperadmin() ? html`<button type="button" class="btn soft" data-act="new">${icon('plus', 18)}${t('groups.newGroup')}</button>` : ''}
        <button type="button" class="btn soft${isSuperadmin() ? '' : ' block'}" data-act="code">${icon('key', 18)}${t('groups.enterCode')}</button>
      </div>
    </div>

    ${g ? html`
    ${code ? html`
    <div class="card invite-card" data-invite>
      <h3 class="section-title">${t('groups.invite')}</h3>
      <div class="code-row">
        <span class="code">${code}</span>
        <button type="button" class="btn soft small" data-act="copy" style="background:var(--sf2)">${icon('copy', 16)}${t('groups.copy')}</button>
      </div>
      <div class="two">
        <button type="button" class="btn small" data-act="share">${icon('share', 18)}${t('groups.shareLink')}</button>
        <button type="button" class="btn small soft" data-act="qr">${icon('qrCode', 18)}${t('groups.qr')}</button>
      </div>
      <span class="hint">${t('groups.inviteHint')}</span>
      <button type="button" class="btn small ghost" data-act="renew">${icon('arrowCounterClockwise', 16)}${t('groups.renew')}</button>
    </div>` : html`
    <p class="hint invite-none" data-invite-none>${icon('lock', 16)}<span>${t('groups.inviteAdminsOnly')}</span></p>`}

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('groups.members')}</h3><span class="tiny muted">${members.length}</span></div>
      <div class="list">
        ${members.map((m) => html`
          <a class="row" href="#/profil/${m.id}">
            ${avatar({ name: memberName(m), url: urls[memberAvatarPath(m)], size: 40 })}
            <span class="grow"><span class="title">${memberName(m)}${m.profile_id === state.profile?.id ? html` <span class="muted">·</span> <span class="muted tiny">ich</span>` : ''}</span></span>
            ${roleChip(m)}
          </a>`)}
      </div>
      <a class="btn soft" href="#/spieler-neu">${icon('userPlus', 20)}${t('groups.addPlaceholder')}</a>
      <span class="hint">${t('groups.addPlaceholderHint')}</span>
    </div>

    ${isAdmin() ? html`
    <div class="card danger-zone">
      <div class="grow-col"><h3 class="section-title">${t('groups.dangerTitle')}</h3><span class="hint">${t('groups.dangerSub')}</span></div>
      <button type="button" class="btn danger" data-act="delete-group">${icon('trash', 18)}${t('groups.deleteGroup')}</button>
    </div>` : ''}` : ''}`);

  on(el, 'click', '[data-group]', (e, b) => { setGroup(b.dataset.group); go('/gruppen'); });
  on(el, 'click', '[data-act="new"]', () => { if (isSuperadmin()) openNewGroup(); });
  on(el, 'click', '[data-act="code"]', () => openEnterCode());
  on(el, 'click', '[data-act="copy"]', () => copyText(code));
  on(el, 'click', '[data-act="share"]', () => shareInvite(g, code));
  on(el, 'click', '[data-act="qr"]', () => openInviteQr(g, code));
  on(el, 'click', '[data-act="renew"]', () => openRenew(g));
  on(el, 'click', '[data-act="delete-group"]', async (e, b) => {
    if (!isAdmin()) return;
    await busy(b, async () => {
      try {
        const { count, error } = await sb.from('games').select('id', { count: 'exact', head: true }).eq('playgroup_id', g.id);
        if (error) throw error;
        const guests = members.filter((m) => !m.profile_id).length;
        openDeleteGroup(g, { games: count ?? 0, members: members.length - guests, guests });
      } catch (ex) { toast(errText(ex)); }
    });
  });
}
