// Profil (eigenes oder fremdes Mitglied der aktuellen Playgroup)
import { sb, must, avatarUrls, appUrl } from '../supabase.js';
import { state, currentMembership, currentGroup, isAdmin, updateProfile, loadMe } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, backHead, empty, memberName, memberAvatarPath, roleChip } from '../lib/parts.js';
import { sheet, toast, errText, copyText } from '../lib/ui.js';
import { setAvatar, removeAvatar } from '../lib/avatar.js';
import { t, fmtDate, getLang } from '../i18n/index.js';
import { go } from '../router.js';
import { MEMBER_SELECT } from './groups.js';

// Vorschau je Look: Hintergrund, Fläche, Hauptknopf
const LOOKS = {
  nacht: ['#0D1117', '#222936', '#F3F6FA'], arktis: ['#E4EDF6', '#F6F9FC', '#0E1A2B'], burgund: ['#3A0A18', '#661B31', '#F0C46A'],
};

export default async function profile(el, { params, isStale }) {
  const mineId = currentMembership()?.id;
  const memberId = params.memberId || mineId;
  const m = await sb.from('members').select(MEMBER_SELECT).eq('id', memberId).maybeSingle().then(must);
  if (isStale()) return;
  if (!m) { mount(el, html`${backHead(t('nav.me'), '#/gruppen')}${empty('user', t('profile.notFound'), '')}`); return; }

  const [statsRows, urls] = await Promise.all([
    sb.from('v_member_stats').select('*').eq('member_id', m.id).then(must),
    avatarUrls([memberAvatarPath(m)]),
  ]);
  if (isStale()) return;

  const isMe = m.profile_id && m.profile_id === state.profile?.id;
  const isGuest = !m.profile_id;
  const canEdit = isMe || isGuest; // Bild und Name: eigenes Profil und Spieler ohne Konto
  const name = isMe ? state.profile.display_name : memberName(m);
  const avPath = isMe ? state.profile.avatar_path : memberAvatarPath(m);
  const st = statsRows[0] || {};
  const num = (v) => (v == null ? '–' : String(v).replace('.', getLang() === 'de' ? ',' : '.'));
  const group = state.memberships.find((x) => x.playgroup_id === m.playgroup_id)?.playgroups || currentGroup();
  const target = isMe ? { kind: 'profile', id: state.profile.id } : { kind: 'member', id: m.id };
  const showBack = !!params.memberId && params.memberId !== mineId;

  const av = avatar({ name, url: urls[avPath], size: 72 });
  mount(el, html`
    ${showBack ? html`<div class="head"><a class="icon-btn" href="#/gruppen" aria-label="${t('common.back')}">${icon('back')}</a></div>` : ''}
    <div class="prof-head">
      ${canEdit
        ? html`<button type="button" class="avatar-edit" data-act="photo" aria-label="${t('avatar.change', { name })}">${av}<span class="cam">${icon('camera', 14)}</span></button>`
        : av}
      <div class="grow-col">
        <h2 class="prof-name">${name}${canEdit ? html`<button type="button" class="rename" data-act="rename" aria-label="${t('profile.rename')}">${icon('edit', 16)}</button>` : ''}</h2>
        <span class="small muted">${t('profile.since', { group: group?.name || '', date: fmtDate(m.created_at) })}</span>
        <span>${roleChip(m)}</span>
      </div>
    </div>

    ${isGuest && m.claim_code ? html`
    <div class="guest-card">
      <b>${t('profile.guestTitle', { name })}</b>
      <span class="hint">${t('profile.guestText', { name })}</span>
      <div class="code-row">
        <span class="code">${m.claim_code}</span>
        <button type="button" class="btn small" data-act="claim-link">${icon('copy', 16)}${t('groups.copyLink')}</button>
      </div>
    </div>` : ''}

    <div class="stats">
      <div class="stat"><b>${num(st.games ?? 0)}</b><span>${t('profile.stats.games')}</span></div>
      <div class="stat"><b>${num(st.wins ?? 0)}</b><span>${t('profile.stats.wins')}</span></div>
      <div class="stat"><b>${num(st.points ?? 0)}</b><span>${t('profile.stats.points')}</span></div>
      <div class="stat"><b>${num(st.avg_place)}</b><span>${t('profile.stats.place')}</span></div>
    </div>

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('profile.decks')}</h3></div>
      <div class="card">${empty('play', t('profile.decks'), t('profile.decksSoon'))}</div>
    </div>

    ${isAdmin() && !isGuest && !isMe ? html`
    <button type="button" class="btn soft" data-act="role">${icon('shield', 18)}${m.role === 'admin' ? t('profile.removeAdmin') : t('profile.makeAdmin')}</button>` : ''}

    ${isMe ? html`
    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('profile.settings')}</h3></div>
      <div class="card">
        <div class="set-row">
          <span class="small" style="font-weight:600">${t('profile.language')}</span>
          <div class="seg">${['de', 'en'].map((l) => html`<button type="button" data-lang="${l}" aria-pressed="${state.profile.locale === l}">${l.toUpperCase()}</button>`)}</div>
        </div>
        <div class="field">
          <span class="small" style="font-weight:600">${t('profile.look')}</span>
          <div class="looks">${Object.entries(LOOKS).map(([k, [a, b, c]]) => html`
            <button type="button" class="look" data-look="${k}" aria-pressed="${state.profile.theme === k}">
              <span class="sw" style="background:${a}"><i style="background:${b}"></i><i style="background:${c}"></i></span>${t(`profile.looks.${k}`)}</button>`)}
          </div>
        </div>
        <a class="set-link" href="#/gruppen">${t('profile.manageGroups')}${icon('chevRight', 18)}</a>
        <button type="button" class="btn danger" data-act="logout">${icon('logout', 18)}${t('profile.logout')}</button>
      </div>
    </div>` : ''}`);

  const rerender = () => go(location.hash.slice(1));

  on(el, 'click', '[data-act="photo"]', () => openAvatarSheet({ name, url: urls[avPath], has: !!avPath, target, isMe, onDone: rerender }));
  on(el, 'click', '[data-act="rename"]', () => openRename({ name, isMe, member: m, onDone: rerender }));
  on(el, 'click', '[data-act="claim-link"]', () => copyText(appUrl(`#/code/${m.claim_code}`)));
  on(el, 'click', '[data-act="logout"]', () => sb.auth.signOut());
  on(el, 'click', '[data-lang]', async (e, b) => { try { await updateProfile({ locale: b.dataset.lang }); rerender(); } catch (ex) { toast(errText(ex)); } });
  on(el, 'click', '[data-look]', async (e, b) => { try { await updateProfile({ theme: b.dataset.look }); rerender(); } catch (ex) { toast(errText(ex)); } });
  on(el, 'click', '[data-act="role"]', async (e, b) => {
    await busy(b, async () => {
      try {
        must(await sb.rpc('set_member_role', { p_member: m.id, p_role: m.role === 'admin' ? 'member' : 'admin' }));
        toast(t('profile.roleChanged')); rerender();
      } catch (ex) { toast(errText(ex)); }
    });
  });
}

function openAvatarSheet({ name, url, has, target, isMe, onDone }) {
  sheet(t('avatar.title'), html`
    <div class="prof-head">
      ${avatar({ name, url, size: 64 })}
      <div class="grow-col"><span class="sheet-title">${t('avatar.title')}</span><span class="small muted">${isMe ? name : t('avatar.forWhom', { name })}</span></div>
    </div>
    <label class="sheet-opt">${icon('camera', 20, 1.8)}<span>${t('avatar.take')}</span><input type="file" accept="image/*" capture="user"></label>
    <label class="sheet-opt">${icon('image', 20, 1.8)}<span>${t('avatar.gallery')}</span><input type="file" accept="image/*"></label>
    ${has ? html`<button type="button" class="sheet-opt danger" data-act="remove">${icon('trash', 20, 1.8)}<span>${t('avatar.remove')}</span></button>` : ''}
    <p class="error" role="alert" hidden></p>
    <span class="hint">${t('avatar.hint')}</span>`, (sh, close) => {
    const err = sh.querySelector('.error');
    const done = async (fn, msg) => {
      sh.setAttribute('aria-busy', 'true');
      try { await fn(); if (isMe) await loadMe(); close(); toast(msg); onDone(); }
      catch (ex) { err.textContent = /kein Bild|decode|toBlob/i.test(ex.message) ? t('avatar.tooBig') : errText(ex); err.hidden = false; }
      finally { sh.removeAttribute('aria-busy'); }
    };
    on(sh, 'change', 'input[type=file]', (e, input) => {
      const f = input.files?.[0];
      if (f) done(() => setAvatar(target, f), t('avatar.saved'));
    });
    on(sh, 'click', '[data-act="remove"]', () => done(() => removeAvatar(target), t('avatar.removed')));
  });
}

function openRename({ name, isMe, member, onDone }) {
  sheet(t('profile.rename'), html`
    <h2>${t('profile.rename')}</h2>
    <form class="form" novalidate>
      <div class="field"><label for="rn-name">${t('auth.name')}</label>
        <input id="rn-name" class="input" maxlength="40" value="${name}" autocomplete="off"></div>
      <p class="error" role="alert" hidden></p>
      <button class="btn block" type="submit">${t('profile.save')}</button>
    </form>`, (sh, close) => {
    on(sh, 'submit', 'form', async (e) => {
      e.preventDefault();
      const err = sh.querySelector('.error');
      const v = sh.querySelector('#rn-name').value.trim();
      if (!v || v.length > 40) { err.textContent = t('auth.errors.name'); err.hidden = false; return; }
      await busy(sh.querySelector('button[type=submit]'), async () => {
        try {
          if (isMe) {
            await updateProfile({ display_name: v });
            // Kopie des Namens in allen eigenen Mitgliedschaften mitziehen
            must(await sb.from('members').update({ display_name: v }).eq('profile_id', state.profile.id));
            await loadMe();
          } else {
            must(await sb.from('members').update({ display_name: v }).eq('id', member.id));
          }
          close(); toast(t('profile.saved')); onDone();
        } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
      });
    });
  });
}
