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
import { groupData } from '../lib/data.js';
import { deckProfile, gameSummary } from '../lib/stats.js';
import { fmtAvg, fmtPct } from '../lib/format.js';
import { kpis, section, iconScale, fmtDay } from './stats-ui.js';
import { renderDeckList } from './deck-list.js';

export default async function deckView(el, { params, isStale }) {
  const d = await sb.from('decks').select('*').eq('id', params.id).maybeSingle().then(must);
  if (isStale()) return;
  if (!d) { mount(el, html`${backHead('', '#/profil')}${empty('play', t('decks.notFound'), '')}`); return; }

  // Besitzer: Konto → Profil, Spieler ohne Konto → Mitglied
  const [owner, ownerMember, data] = await Promise.all([
    d.owner_profile_id ? sb.from('profiles').select('display_name').eq('id', d.owner_profile_id).maybeSingle().then(must) : null,
    d.owner_member_id
      ? sb.from('members').select('id, display_name, profile_id').eq('id', d.owner_member_id).maybeSingle().then(must)
      : sb.from('members').select('id').eq('profile_id', d.owner_profile_id).eq('playgroup_id', state.groupId).maybeSingle().then(must),
    // Statistik: eine Rechenquelle (stats.js über groupData, WELLE D3); ein Ausfall bricht die Seite nicht
    groupData.loadGroup(state.groupId).catch((ex) => { console.warn('Statistik laden', ex); return null; }),
  ]);
  if (isStale()) return;
  const ownerName = owner?.display_name || ownerMember?.display_name || '';
  const canEdit = d.owner_profile_id === state.profile?.id || (!!d.owner_member_id && !ownerMember?.profile_id);
  const backTo = ownerMember?.id ? `#/profil/${ownerMember.id}` : '#/profil';
  const lang = getLang();
  const dp = data ? deckProfile(data, d.id) : null;
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

    ${dp ? deckStats(dp, data, d.id, lang) : html`<p class="small muted st-err">${t('stats.loadError')}</p>`}

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('decks.list')}</h3></div>
      <div class="dl-slot" data-decklist></div>
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

  // Deckliste (P5): Import, Kennzahlen, Kartenbild, Bracket-Prüfung — eigene Datei deck-list.js
  renderDeckList(el.querySelector('[data-decklist]'), { deck: d, canEdit }).catch((ex) => console.warn('Deckliste', ex));

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
        try { await update({ bracket: Number(b.dataset.br) }); groupData.invalidate(state.groupId); close(); toast(t('profile.saved')); rerender(); } // P12 Nachtrag 1 (B2): Gruppen-Stand verworfen
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
            try { await update({ archived: true }); groupData.invalidate(state.groupId); close(); toast(t('decks.archived')); go(backTo.slice(1), { replace: true }); } // P12 Nachtrag 1 (B2)
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

// ---- Statistik (P18) ----

/**
 * Kacheln, Bewertung und letzte Spiele aus deckProfile (Zahlen fertig aus stats.js).
 * Nie gespielt ⇒ Kacheln 0/–, keine Bewertung, Leerzustand statt Spielliste.
 * @param {import('../lib/stats.js').DeckProfile} dp
 * @param {import('../lib/history-data.js').GroupData} data
 * @param {string} deckId
 * @param {string} lang
 */
function deckStats(dp, data, deckId, lang) {
  const tiles = kpis([
    { v: dp.games, l: t('decks.games') },
    { v: dp.wins, l: t('decks.wins') },
    { v: fmtPct(dp.winRate, lang), l: t('decks.winrate') },
    { v: fmtAvg(dp.avgPlace, lang), l: t('decks.place') },
    { v: dp.points, l: t('profile.stats.points') },
  ]);
  if (!dp.games) return html`${tiles}<div class="card">${empty('play', t('decks.noGames'), '')}</div>`;

  const rating = section(t('stats.rating'), html`<div class="card st-rate">
    <div class="st-rate-row">
      <span class="st-mood-txt"><span>${t('stats.ownRating')}</span></span>
      ${iconScale(dp.avgOwnRating, 'star', lang)}<b class="st-val">${fmtAvg(dp.avgOwnRating, lang)}</b>
    </div>
    <div class="st-rate-row">
      <span class="st-mood-txt"><span>${t('stats.salt')}</span><span class="tiny muted">${dp.salt
        ? t(dp.salt.ratings === 1 ? 'stats.saltLine1' : 'stats.saltLineN', { v: fmtAvg(dp.salt.avgSalt, lang), n: dp.salt.ratings })
        : t('stats.noSalt')}</span></span>
      ${iconScale(dp.salt ? dp.salt.avgSalt : null, 'salt', lang)}<b class="st-val">${fmtAvg(dp.salt ? dp.salt.avgSalt : null, lang)}</b>
    </div>
    <div class="st-rate-row">
      <span class="st-mood-txt"><span>${t('stats.fun')}</span></span>
      ${iconScale(dp.avgFun, 'fun', lang)}<b class="st-val">${fmtAvg(dp.avgFun, lang)}</b>
    </div>
  </div>`);

  const rows = dp.recentGameIds.map((id) => {
    const g = gameSummary(data, id);
    const p = g?.placements.find((x) => x.deckId === deckId) || null;
    const place = p?.place ?? null;
    return html`<a class="st-game" href="#/partie/${encodeURIComponent(id)}">
      <span class="st-place ${place === 1 ? 'win' : ''}" aria-hidden="true">${place === 1 ? icon('trophyFill', 18) : place ?? '–'}</span>
      <span class="grow-col"><b>${place === 1 ? t('stats.win') : place != null ? t('stats.place', { n: place }) : '–'}</b>
        <span class="small muted">${fmtDay(g?.startedAt, lang)}${g?.rounds ? ` · ${t('stats.rounds', { n: g.rounds })}` : ''}</span></span>
      <span class="st-hl-go" aria-hidden="true">${icon('chevRight', 18)}</span>
    </a>`;
  });
  const recent = section(t('stats.recent'), html`<div class="card st-games">${rows}</div>`);
  return html`${tiles}${rating}${recent}`;
}
