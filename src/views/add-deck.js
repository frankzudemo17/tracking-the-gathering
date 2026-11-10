// Commander hinzufügen: Scryfall-Suche (inkl. Partner), Bracket, Link zur Deckliste
import { sb, must } from '../supabase.js';
import { state } from '../state.js';
import { html, mount, on, busy, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead, empty, manaPips, memberName } from '../lib/parts.js';
import { errText, toast } from '../lib/ui.js';
import { searchCommanders, partnerKind, artUrl, shortName } from '../lib/scryfall.js';
import { BRACKETS, sortColors, normalizeLink } from '../lib/decks.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';
import { MEMBER_SELECT } from './groups.js';
import { getPrefs } from '../lib/prefs.js';

// Rückweg ins Setup (Spec P7): #/…?zurueck=setup — der Router ignoriert den Query-Teil.
const fromSetup = () => new URLSearchParams(location.hash.split('?')[1] || '').get('zurueck') === 'setup';

export default async function addDeck(el, { params, isStale }) {
  const member = await sb.from('members').select(MEMBER_SELECT).eq('id', params.memberId).maybeSingle().then(must);
  if (isStale()) return;
  const isMe = member?.profile_id && member.profile_id === state.profile?.id;
  if (!member || (!isMe && member.profile_id)) { mount(el, html`${backHead('', '#/profil')}${empty('play', t('decks.notFound'), '')}`); return; }

  const back = fromSetup();
  const s = { primary: null, partner: null, searchingPartner: false, bracket: 3, link: '' };
  let ctrl = null; let timer = null;

  mount(el, html`
    ${backHead(t('decks.add'), back ? '#/spiel-neu' : `#/profil/${member.id}`)}
    ${isMe ? '' : html`<p class="muted" style="margin-top:-8px">${t('decks.addFor', { name: memberName(member) })}</p>`}
    <div id="ad-pick" class="section"></div>
    <div id="ad-rest" class="form" hidden>
      <div class="field">
        <span class="lbl" id="ad-br-l">${t('decks.bracket')}</span>
        <div class="bracket" role="radiogroup" aria-labelledby="ad-br-l">
          ${BRACKETS.map((b) => html`<button type="button" role="radio" data-br="${b.n}" aria-checked="${b.n === s.bracket}"><b>${b.n}</b><span>${b.de}</span></button>`)}
        </div>
        <span class="hint">${t('decks.bracketHint')}</span>
      </div>
      <div class="field">
        <label for="ad-link">${t('decks.link')}</label>
        <input id="ad-link" class="input" type="url" inputmode="url" autocomplete="off" placeholder="${t('decks.linkPh')}">
        <span class="hint">${t('decks.linkHint')}</span>
      </div>
      <p class="error" role="alert" hidden></p>
      <button type="button" class="btn block" data-act="save">${icon('check', 20)}${t('decks.save')}</button>
    </div>`);

  const pick = $('#ad-pick', el);
  const rest = $('#ad-rest', el);

  function resultRow(c) {
    const pk = partnerKind(c);
    return html`<button type="button" class="result" data-id="${c.id}">
      <span class="thumb" style="background-image:url('${artUrl(c)}')"></span>
      <span class="grow"><span class="title">${c.name}</span>
        <span class="meta">${manaPips(sortColors(c.color_identity), 10)}${pk ? html`<span class="chip">${t('decks.partnerTag')}</span>` : ''}</span></span>
      ${icon('plus', 20)}
    </button>`;
  }

  function searchBlock(forPartner) {
    return html`<div class="field">
        <label for="ad-q">${forPartner ? t('decks.searchPartner') : t('decks.search')}</label>
        <input id="ad-q" class="input" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t('decks.searchPh')}">
      </div>
      <div id="ad-res" class="results" aria-live="polite"></div>`;
  }

  let found = [];
  async function runSearch() {
    const res = $('#ad-res', el); const q = $('#ad-q', el)?.value || '';
    if (!res) return;
    const partner = s.searchingPartner ? partnerKind(s.primary) : null;
    if (!partner && q.trim().length < 2) { mount(res, q.trim() ? html`<p class="hint">${t('decks.typeMore')}</p>` : ''); return; }
    ctrl?.abort(); ctrl = new AbortController();
    mount(res, html`<p class="hint">${t('decks.searching')}</p>`);
    try {
      found = await searchCommanders(q, { partner, signal: ctrl.signal });
      if (s.searchingPartner) found = found.filter((c) => c.id !== s.primary.id);
      mount(res, found.length ? html`<div class="list">${found.map(resultRow)}</div>` : html`<p class="hint">${t('decks.noResults')}</p>`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      mount(res, html`<p class="error">${t('decks.searchError')}</p>`);
    }
  }

  function render() {
    if (!s.primary) {
      mount(pick, searchBlock(false));
      rest.hidden = true;
      $('#ad-q', el).focus();
      return;
    }
    const pk = partnerKind(s.primary);
    const cards = [s.primary, s.partner].filter(Boolean);
    mount(pick, html`
      <div class="deck-hero ${cards.length > 1 ? 'split' : ''}">
        ${cards.map((c) => html`<span class="art" style="background-image:url('${artUrl(c)}')"></span>`)}
        <div class="deck-hero-text">
          ${manaPips(sortColors([...s.primary.color_identity, ...(s.partner?.color_identity || [])]))}
          <h2>${cards.map((c) => c.name).join(' & ')}</h2>
        </div>
      </div>
      <div class="two">
        <button type="button" class="btn soft" data-act="change">${t('decks.change')}</button>
        ${pk && !s.partner && !s.searchingPartner ? html`<button type="button" class="btn soft" data-act="partner">${icon('plus', 18)}${t('decks.addPartner')}</button>` : ''}
        ${s.partner ? html`<button type="button" class="btn soft" data-act="unpartner">${t('decks.removePartner')}</button>` : ''}
      </div>
      ${pk && !s.partner ? html`<p class="hint">${t(`decks.partnerHint.${pk.kind}`, { name: pk.name || '' })}</p>` : ''}
      ${s.searchingPartner ? searchBlock(true) : ''}`);
    rest.hidden = s.searchingPartner;
    if (s.searchingPartner) { runSearch(); $('#ad-q', el).focus(); }
  }

  on(el, 'input', '#ad-q', () => { clearTimeout(timer); timer = setTimeout(runSearch, 280); });
  on(el, 'click', '.result', (e, b) => {
    const c = found.find((x) => x.id === b.dataset.id);
    if (!c) return;
    if (s.searchingPartner) { s.partner = c; s.searchingPartner = false; } else { s.primary = c; s.partner = null; }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  on(el, 'click', '[data-act="change"]', () => { s.primary = null; s.partner = null; s.searchingPartner = false; render(); });
  on(el, 'click', '[data-act="partner"]', () => { s.searchingPartner = true; render(); });
  on(el, 'click', '[data-act="unpartner"]', () => { s.partner = null; render(); });
  on(el, 'click', '[data-br]', (e, b) => {
    s.bracket = Number(b.dataset.br);
    el.querySelectorAll('[data-br]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  on(el, 'click', '[data-act="save"]', async (e, btn) => {
    const err = $('#ad-rest .error', el);
    err.hidden = true;
    const link = normalizeLink($('#ad-link', el).value);
    if (link === null) { err.textContent = t('decks.linkBad'); err.hidden = false; return; }
    const cards = [s.primary, s.partner].filter(Boolean);
    const row = {
      owner_profile_id: isMe ? member.profile_id : null,
      owner_member_id: isMe ? null : member.id,
      commander_name: s.primary.name,
      partner_name: s.partner?.name || null,
      short_name: cards.map((c) => shortName(c.name)).join(' & ').slice(0, 80),
      scryfall_ids: cards.map((c) => c.id),
      image_url: artUrl(s.primary),
      partner_image_url: s.partner ? artUrl(s.partner) : null,
      color_identity: sortColors(cards.flatMap((c) => c.color_identity)),
      bracket: s.bracket,
      list_url: link || null,
      counter_pins: getPrefs().defaultPins, // Standard-Pins dieses Geräts (P7, Spiel-Standards)
    };
    await busy(btn, async () => {
      try {
        const d = await sb.from('decks').insert(row).select('id').single().then(must);
        toast(t('decks.saved'));
        go(back ? `/spiel-neu?deck=${d.id}&fuer=${member.id}` : `/deck/${d.id}`, { replace: true });
      } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
    });
  });

  render();
}
