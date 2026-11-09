// Deckprofil: Commander-Art, Kennzahlen, Deckliste, Bracket, entfernen
import { sb, must } from '../supabase.js';
import { state } from '../state.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead, empty, manaPips } from '../lib/parts.js';
import { sheet, toast, errText } from '../lib/ui.js';
import { BRACKETS, bracketName, sortColors, linkInfo, normalizeLink } from '../lib/decks.js';
import { t, getLang } from '../i18n/index.js';
import { go } from '../router.js';

export default async function deckView(el, { params, isStale }) {
  const d = await sb.from('decks').select('*').eq('id', params.id).maybeSingle().then(must);
  if (isStale()) return;
  if (!d) { mount(el, html`${backHead('', '#/profil')}${empty('play', t('decks.notFound'), '')}`); return; }

  // Besitzer: Konto → Profil, Spieler ohne Konto → Mitglied
  const [owner, ownerMember, statsRows] = await Promise.all([
    d.owner_profile_id ? sb.from('profiles').select('display_name').eq('id', d.owner_profile_id).maybeSingle().then(must) : null,
    d.owner_member_id
      ? sb.from('members').select('id, display_name, profile_id').eq('id', d.owner_member_id).maybeSingle().then(must)
      : sb.from('members').select('id').eq('profile_id', d.owner_profile_id).eq('playgroup_id', state.groupId).maybeSingle().then(must),
    sb.from('v_deck_stats').select('*').eq('deck_id', d.id).eq('playgroup_id', state.groupId).then(must),
  ]);
  if (isStale()) return;
  const ownerName = owner?.display_name || ownerMember?.display_name || '';
  const canEdit = d.owner_profile_id === state.profile?.id || (!!d.owner_member_id && !ownerMember?.profile_id);
  const backTo = ownerMember?.id ? `#/profil/${ownerMember.id}` : '#/profil';
  const st = statsRows[0] || { games: 0, wins: 0 };
  const fmt = (v) => (v == null ? '–' : String(v).replace('.', getLang() === 'de' ? ',' : '.'));
  const rate = st.games ? `${Math.round((st.wins / st.games) * 100)} %` : '–';
  const link = d.list_url ? linkInfo(d.list_url) : null;
  const arts = [d.image_url, d.partner_image_url].filter(Boolean);
  const names = [d.commander_name, d.partner_name].filter(Boolean);

  mount(el, html`
    ${backHead('', backTo)}
    <div class="deck-hero ${arts.length > 1 ? 'split' : ''}">
      ${arts.map((a) => html`<span class="art" style="background-image:url('${a}')"></span>`)}
      <div class="deck-hero-text">
        <div class="deck-meta">${manaPips(sortColors(d.color_identity))}<span class="chip">${t('decks.bracket')} ${d.bracket} · ${bracketName(d.bracket)}</span></div>
        <h2>${names.join(' & ')}</h2>
        <span class="by">${t('decks.by', { name: ownerName })}</span>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><b>${st.games}</b><span>${t('decks.games')}</span></div>
      <div class="stat"><b>${st.wins}</b><span>${t('decks.wins')}</span></div>
      <div class="stat"><b>${rate}</b><span>${t('decks.winrate')}</span></div>
      <div class="stat"><b>${fmt(st.avg_place)}</b><span>${t('decks.place')}</span></div>
    </div>

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('decks.list')}</h3></div>
      <div class="card">
        ${link ? html`
          <div class="set-row"><span class="grow-col"><b>${link.label}</b><span class="tiny muted" style="overflow-wrap:anywhere">${d.list_url}</span></span></div>
          <div class="two">
            <a class="btn small" href="${d.list_url}" target="_blank" rel="noopener noreferrer">${icon('link', 18)}${t('decks.open')}</a>
            ${canEdit ? html`<button type="button" class="btn soft small" style="background:var(--sf2)" data-act="link">${t('decks.editLink')}</button>` : ''}
          </div>`
        : html`<span class="small muted">${t('decks.noLink')}</span>
          ${canEdit ? html`<button type="button" class="btn soft small" style="background:var(--sf2)" data-act="link">${icon('plus', 18)}${t('decks.addLink')}</button>` : ''}`}
      </div>
    </div>

    ${canEdit ? html`
    <div class="section">
      <button type="button" class="btn soft" data-act="bracket">${t('decks.changeBracket')}</button>
      <button type="button" class="btn danger" data-act="remove">${icon('trash', 18)}${t('decks.remove')}</button>
    </div>` : ''}`);

  const rerender = () => go(location.hash.slice(1));
  const update = async (patch) => { await sb.from('decks').update(patch).eq('id', d.id).select('id').single().then(must); };

  on(el, 'click', '[data-act="link"]', () => {
    sheet(t('decks.link'), html`
      <h2>${t('decks.link')}</h2>
      <form class="form" novalidate>
        <div class="field"><label for="dl-url">${t('decks.link')}</label>
          <input id="dl-url" class="input" type="url" inputmode="url" autocomplete="off" placeholder="${t('decks.linkPh')}" value="${d.list_url || ''}"></div>
        <span class="hint">${t('decks.linkHint')}</span>
        <p class="error" role="alert" hidden></p>
        <button class="btn block" type="submit">${t('profile.save')}</button>
      </form>`, (sh, close) => {
      on(sh, 'submit', 'form', async (e) => {
        e.preventDefault();
        const err = sh.querySelector('.error');
        const v = normalizeLink(sh.querySelector('#dl-url').value);
        if (v === null) { err.textContent = t('decks.linkBad'); err.hidden = false; return; }
        await busy(sh.querySelector('button[type=submit]'), async () => {
          try { await update({ list_url: v || null }); close(); toast(t('profile.saved')); rerender(); }
          catch (ex) { err.textContent = errText(ex); err.hidden = false; }
        });
      });
    });
  });

  on(el, 'click', '[data-act="bracket"]', () => {
    sheet(t('decks.changeBracket'), html`
      <h2>${t('decks.changeBracket')}</h2>
      <div class="bracket" role="radiogroup" aria-label="${t('decks.bracket')}">
        ${BRACKETS.map((b) => html`<button type="button" role="radio" data-br="${b.n}" aria-checked="${b.n === d.bracket}"><b>${b.n}</b><span>${b.de}</span></button>`)}
      </div>
      <p class="error" role="alert" hidden></p>`, (sh, close) => {
      on(sh, 'click', '[data-br]', async (e, b) => {
        try { await update({ bracket: Number(b.dataset.br) }); close(); toast(t('profile.saved')); rerender(); }
        catch (ex) { const er = sh.querySelector('.error'); er.textContent = errText(ex); er.hidden = false; }
      });
    });
  });

  on(el, 'click', '[data-act="remove"]', () => {
    sheet(t('decks.remove'), html`
      <h2>${t('decks.removeConfirm')}</h2>
      <p class="muted">${names.join(' & ')}</p>
      <p class="error" role="alert" hidden></p>
      <button type="button" class="btn block" style="background:var(--danger);color:#fff" data-act="yes">${icon('trash', 18)}${t('decks.removeYes')}</button>
      <button type="button" class="btn soft block" style="background:var(--sf2)" data-act="no">${t('common.cancel')}</button>`, (sh, close) => {
      on(sh, 'click', '[data-act="no"]', close);
      on(sh, 'click', '[data-act="yes"]', async (e, b) => {
        await busy(b, async () => {
          const { error } = await sb.from('decks').delete().eq('id', d.id);
          // Deck kommt schon in Spielen vor (Fremdschlüssel) → archivieren statt löschen
          if (error?.code === '23503') {
            try { await update({ archived: true }); close(); toast(t('decks.archived')); go(backTo.slice(1), { replace: true }); }
            catch (ex) { const er = sh.querySelector('.error'); er.textContent = errText(ex); er.hidden = false; }
            return;
          }
          if (error) { const er = sh.querySelector('.error'); er.textContent = errText(error); er.hidden = false; return; }
          close(); toast(t('decks.removed')); go(backTo.slice(1), { replace: true });
        });
      });
    });
  });
}
