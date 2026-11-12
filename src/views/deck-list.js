// Deckliste im Deckprofil (Welle ttg-live-feinschliff-decks, P5): ManaBox-Import, Liste mit
// Kennzahlen (Typen, Manakurve, Farben), Kartenbild, Bracket-Prüfung über Commander Spellbook.
// Eingehängt von views/deck.js im Abschnitt „Deckliste“: renderDeckList(slot, { deck, canEdit }).
// Daten und Rechnen kommen aus src/decks/** (P1/P2); hier nur Oberfläche und Texte (Namensraum decklist).
// Das Besitzer-Bracket wird nie automatisch geändert — nur per Knopf („Bracket auf N setzen“).
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { groupData } from '../lib/data.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { empty, loading } from '../lib/parts.js';
import { sheet, toast } from '../lib/ui.js';
import { bracketName } from '../lib/decks.js';
import { t, getLang } from '../i18n/index.js';
import { go } from '../router.js';
import { parseManaBox } from '../decks/manabox.js';
import { resolveCards, saveDeckCards, loadDeckCards, deckSummary, cardType } from '../decks/cards.js';
import { checkDeck, ERROR_CODES } from '../decks/spellbook.js';
import { bracketFloor, compareBracket } from '../decks/bracket.js';

/** Gruppen der Liste in Anzeige-Reihenfolge (Spec); battle und Unbekanntes ⇒ „Sonstige“. */
const GROUPS = ['commander', 'creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'other'];
const CURVE = ['0', '1', '2', '3', '4', '5', '6', '7+'];
const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
const LIST_MAX = 20; // gespeicherte Kombos je Art (bracket_check bleibt klein)

const list = (x) => (Array.isArray(x) ? x : []);
const groupOf = (r) => {
  if (r.section === 'commander') return 'commander';
  const ty = cardType(r.type_line);
  return GROUPS.includes(ty) ? ty : 'other';
};
const sumQty = (rows) => rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
const countText = (n) => (n === 1 ? t('decklist.count1') : t('decklist.count', { n }));
const front = (s) => String(s ?? '').split(' // ')[0].trim().toLowerCase();
const rerender = () => go(location.hash.slice(1));

/** Typen aus deckSummary.byType, auf die Gruppen der Liste abgebildet (battle ⇒ other). */
function typeCounts(sum) {
  const out = {};
  for (const [k, n] of Object.entries(sum.byType)) {
    const g = GROUPS.includes(k) && k !== 'commander' ? k : 'other';
    out[g] = (out[g] || 0) + n;
  }
  return out;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Abschnitt „Deckliste“ in `slot` zeichnen und bedienen.
 * @param {HTMLElement} slot
 * @param {{ deck: any, canEdit: boolean }} opts
 */
export async function renderDeckList(slot, { deck, canEdit }) {
  if (!slot) return;
  const st = {
    deck,
    canEdit: !!canEdit,
    /** @type {any[]} */ cards: [],
    check: deck.bracket_check && typeof deck.bracket_check === 'object' ? deck.bracket_check : null,
    checkSaved: true,
    /** @type {string | null} */ error: null,
    checking: false,
  };

  mount(slot, loading());
  try {
    st.cards = await loadDeckCards(sb, deck.id);
  } catch (ex) {
    console.warn('Deckliste laden', ex);
    if (slot.isConnected) mount(slot, html`<p class="small muted" data-dl-loaderr>${t('decklist.loadError')}</p>`);
    return;
  }
  if (!slot.isConnected) return;

  // ---------------------------------------------------------------- Zeichnen
  function draw() {
    const { cards } = st;
    if (!cards.length) {
      mount(slot, html`<div class="card dl-empty" data-dl-empty>
        ${empty('cards', st.canEdit ? t('decklist.empty') : t('decklist.emptyOther'), st.canEdit ? t('decklist.emptySub') : '')}
        ${st.canEdit ? html`<button type="button" class="btn block" data-act="dl-import">${icon('uploadSimple', 18)}${t('decklist.importBtn')}</button>` : ''}
      </div>`);
      return;
    }
    const sum = deckSummary(cards);
    const total = sum.total + sum.commanders;
    mount(slot, html`
      <div class="card dl-bk" data-dl-bracket></div>
      <div class="card dl-list">
        <div class="dl-head">
          <b class="dl-count" data-dl-count="${total}">${countText(total)}</b>
          ${st.canEdit ? html`<button type="button" class="btn soft small dl-reimport" data-act="dl-import">${icon('uploadSimple', 16)}${t('decklist.reimport')}</button>` : ''}
        </div>
        ${statsBlock(sum)}
        <div class="dl-groups">${groupsBlock(cards)}</div>
      </div>`);
    drawBracket();
  }

  function statsBlock(sum) {
    const types = typeCounts(sum);
    const tKeys = GROUPS.filter((g) => g !== 'commander' && types[g]);
    const tMax = Math.max(1, ...tKeys.map((k) => types[k]));
    const cMax = Math.max(1, ...CURVE.map((k) => sum.curve[k] || 0));
    const cols = COLORS.filter((c) => sum.colors[c]);
    const curveLabel = CURVE.map((k) => `${k}: ${sum.curve[k] || 0}`).join(', ');
    return html`<div class="dl-groups dl-stats">
      <details class="dl-group dl-fold" data-dl-types>
        <summary><span class="dl-group-t">${t('decklist.stats.types')}</span><span class="dl-chev">${icon('chevDown', 16)}</span></summary>
        <div class="dl-types dl-fold-body">${tKeys.map((k) => html`<div class="dl-type" data-type="${k}" data-n="${types[k]}">
          <span class="dl-type-l">${t(`decklist.types.${k}`)}</span>
          <span class="dl-bar" aria-hidden="true"><i style="--v:${types[k] / tMax}"></i></span>
          <b class="dl-num">${types[k]}</b></div>`)}</div>
      </details>
      <details class="dl-group dl-fold" data-dl-curve>
        <summary><span class="dl-group-t">${t('decklist.stats.curve')}<span class="dl-stat-h">${t('decklist.stats.curveHint')}</span></span><span class="dl-chev">${icon('chevDown', 16)}</span></summary>
        <div class="dl-curve dl-fold-body" role="img" aria-label="${t('decklist.stats.curve')}: ${curveLabel}">${CURVE.map((k) => {
          const n = sum.curve[k] || 0;
          return html`<div class="dl-col" data-mv="${k}" data-n="${n}" aria-hidden="true">
            <span class="dl-col-n">${n || ''}</span>
            <span class="dl-col-track"><i style="--v:${n / cMax}"></i></span>
            <span class="dl-col-k">${k}</span></div>`;
        })}</div>
      </details>
      ${cols.length ? html`<details class="dl-group dl-fold" data-dl-colors>
        <summary><span class="dl-group-t">${t('decklist.stats.colors')}<span class="dl-stat-h">${t('decklist.stats.colorsHint')}</span></span><span class="dl-chev">${icon('chevDown', 16)}</span></summary>
        <div class="dl-colors dl-fold-body">${cols.map((c) => html`<span class="dl-color" data-color="${c}" data-n="${sum.colors[c]}">
          <span class="pip dl-pip ${c}" aria-hidden="true"></span><b class="dl-num">${sum.colors[c]}</b><span class="sr-only">${t(`decklist.colors.${c}`)}</span></span>`)}</div>
      </details>` : ''}
    </div>`;
  }

  function groupsBlock(cards) {
    const by = new Map(GROUPS.map((g) => [g, []]));
    cards.forEach((r, i) => by.get(groupOf(r)).push({ r, i }));
    return GROUPS.filter((g) => by.get(g).length).map((g) => {
      const rows = by.get(g).sort((a, b) => a.r.name.localeCompare(b.r.name, 'en'));
      const n = sumQty(rows.map((x) => x.r));
      return html`<details class="dl-group" data-group="${g}">
        <summary><span class="dl-group-t">${t(`decklist.types.${g}`)}</span><span class="dl-group-n">${n}</span><span class="dl-chev">${icon('chevDown', 16)}</span></summary>
        <ul class="dl-rows">${rows.map(({ r, i }) => html`<li><button type="button" class="dl-card" data-act="dl-card" data-i="${i}" data-name="${r.name}" data-qty="${r.qty}">
          <span class="dl-q">${r.qty}</span><span class="dl-dot" aria-hidden="true">·</span><span class="dl-nm">${r.name}</span>
          ${r.game_changer ? html`<span class="dl-gc" title="${t('decklist.gc')}">${icon('lightning', 12)}${t('decklist.gcShort')}<span class="sr-only"> ${t('decklist.gc')}</span></span>` : ''}
          <span class="dl-mv">${g === 'land' || r.mana_value == null ? '' : Number(r.mana_value)}</span>
        </button></li>`)}</ul>
      </details>`;
    });
  }

  // ---------------------------------------------------------------- Bracket-Karte
  function isOutdated(c) {
    const now = st.deck.cards_updated_at ? new Date(st.deck.cards_updated_at).getTime() : null;
    if (now == null || Number.isNaN(now)) return false;
    const then = c.cards_updated_at ? new Date(c.cards_updated_at).getTime() : NaN;
    return Number.isNaN(then) || now > then;
  }

  function reasonText(r) {
    if (r.code === 'gc') return t(r.floor >= 4 ? 'decklist.bracket.reasons.gc4' : 'decklist.bracket.reasons.gc3');
    const k = `decklist.bracket.reasons.${r.code}`;
    const s = t(k);
    return s === k ? t('decklist.bracket.reasons.other', { n: r.floor }) : s;
  }
  function hintText(h) {
    const n = h.count ?? list(h.cards).length;
    const k = `decklist.bracket.hintCodes.${h.code}${n === 1 && h.code === 'unknown_cards' ? '1' : ''}`;
    const s = t(k, { n });
    return s === k ? t('decklist.bracket.hintCodes.other') : s;
  }

  /** Nur das, was das Bracket begründet (Franco, 10.11.2026): Gründe mit Karten. Kombo-Listen, „fast fertige“ Kombos,
   *  Tutoren/Mana-Hinweise und die Spellbook-Einstufung zeigt die Karte nicht mehr. Bleiben: gebannte und unbekannte Karten,
   *  weil sie sagen, wie belastbar das Ergebnis ist. */
  function resultBlock(c) {
    const floor = Number(c.floor) || 1;
    const cmp = compareBracket(st.deck.bracket, floor);
    const reasons = list(c.reasons);
    const notes = list(c.hints).filter((h) => h.code === 'unknown_cards');
    if (list(c.banned).length) notes.push({ code: 'banned', cards: c.banned });
    return html`<div class="dl-bk-res" data-floor="${floor}">
      ${isOutdated(c) ? html`<p class="dl-bk-note" data-dl-stale>${icon('warn', 16)}<span>${t('decklist.bracket.stale')}</span></p>` : ''}
      ${!st.checkSaved ? html`<p class="tiny muted">${t('decklist.bracket.notSaved')}</p>` : ''}
      ${cmp === 'below' ? html`<div class="dl-bk-below" data-dl-below>
          <span class="dl-bk-below-ic">${icon('warningCircle', 20)}</span>
          <span class="grow-col"><b>${t('decklist.bracket.below', { owner: st.deck.bracket, floor })}</b><span class="small">${t('decklist.bracket.belowHint')}</span></span>
        </div>
        ${st.canEdit ? html`<button type="button" class="btn small block" data-act="dl-set" data-n="${floor}">${t('decklist.bracket.setTo', { n: floor })}</button>` : ''}` : ''}
      ${reasons.length
        ? html`<ul class="dl-bk-list">${reasons.map((r) => html`<li data-reason="${r.code}"><b>${reasonText(r)}</b>${list(r.cards).length ? html`<span class="small">${list(r.cards).join(', ')}</span>` : ''}</li>`)}</ul>`
        : html`<p class="small muted" data-dl-clean>${t('decklist.bracket.clean')}</p>`}
      ${notes.length ? html`<ul class="dl-bk-list dl-bk-hints">${notes.map((h) => html`<li data-hint="${h.code}"><b>${hintText(h)}</b>${list(h.cards).length ? html`<span class="small">${list(h.cards).join(', ')}</span>` : ''}</li>`)}</ul>` : ''}
    </div>`;
  }

  function drawBracket() {
    const box = slot.querySelector('[data-dl-bracket]');
    if (!box) return;
    const c = st.check;
    const offline = !navigator.onLine;
    const floor = c ? Number(c.floor) || 1 : 0;
    const sub = st.checking ? t('decklist.bracket.checking') : c?.checked_at ? t('decklist.bracket.checkedAt', { date: fmtDate(c.checked_at) }) : t('decklist.bracket.intro');
    // Mit Ergebnis: kleiner Knopf im Kopf. Ohne Ergebnis oder nach einem Fehler: der breite Knopf darunter.
    const wide = !c || !!st.error;
    const label = st.checking ? t('decklist.bracket.checking') : st.error ? t('decklist.bracket.retry') : t('decklist.bracket.check');
    const off = offline || st.checking ? 'disabled' : '';
    mount(box, html`
      <div class="dl-bk-head">
        <span class="dl-bk-ic">${icon('shieldStar', 20)}</span>
        <span class="grow-col">${c
          ? html`<span class="dl-bk-title" data-dl-result><b>${floor <= 1 ? t('decklist.bracket.level12') : t('decklist.bracket.level', { n: floor })}</b> <span>${floor <= 1 ? t('decklist.bracket.name12') : bracketName(floor)}</span></span>`
          : html`<b>${t('decklist.bracket.title')}</b>`}
          <span class="tiny muted">${sub}</span></span>
        ${wide ? '' : html`<button type="button" class="icon-btn dl-bk-re" data-act="dl-check" aria-label="${t('decklist.bracket.recheck')}" title="${t('decklist.bracket.recheck')}" ${off} ${st.checking ? html`aria-busy="true"` : ''}>${icon('arrowCounterClockwise', 20)}</button>`}
      </div>
      ${c ? resultBlock(c) : ''}
      ${st.error ? html`<p class="dl-bk-err" role="alert" data-dl-error="${st.error}">${icon('warningCircle', 18)}<span>${t(`decklist.bracket.errors.${st.error}`)}</span></p>` : ''}
      ${offline ? html`<p class="dl-bk-note" data-dl-offline>${icon('wifiSlash', 16)}<span>${t('decklist.bracket.offline')}</span></p>` : ''}
      ${wide ? html`<button type="button" class="btn small block dl-bk-btn" data-act="dl-check" ${off} ${st.checking ? html`aria-busy="true"` : ''}>
        ${icon(st.error ? 'arrowCounterClockwise' : 'chartBar', 18)}${label}</button>` : ''}
      <p class="tiny muted dl-bk-src">${t('decklist.bracket.source')}</p>`);
  }

  async function runCheck() {
    if (st.checking) return;
    if (!navigator.onLine) { drawBracket(); return; }
    st.error = null;
    st.checking = true;
    drawBracket();
    let res = null;
    try {
      res = await checkDeck(sb, st.cards);
    } catch (e) {
      const code = e && ERROR_CODES.includes(e.code) ? e.code : 'unavailable';
      console.warn('Bracket-Prüfung', code, e?.status ?? '');
      st.error = code;
    }
    if (res) {
      const r = bracketFloor(res);
      const check = {
        floor: r.floor, reasons: r.reasons, hints: r.hints, banned: r.banned, tag: r.tag,
        combos: list(res.combos).slice(0, LIST_MAX).map((k) => ({ cards: list(k.cards), produces: list(k.produces) })),
        checked_at: new Date().toISOString(),
        cards_updated_at: st.deck.cards_updated_at ?? null,
      };
      st.check = check;
      st.checkSaved = false;
      if (st.canEdit) {
        const { error } = await sb.from('decks').update({ bracket_check: check }).eq('id', st.deck.id).select('id').single();
        if (error) { console.warn('bracket_check speichern', error.message); toast(t('decklist.bracket.saveFailed')); }
        else { st.checkSaved = true; st.deck.bracket_check = check; }
      }
    }
    st.checking = false;
    if (slot.isConnected) drawBracket();
  }

  async function setBracket(btn) {
    const n = Number(btn.dataset.n);
    if (!Number.isInteger(n) || n < 1 || n > 5) return;
    await busy(btn, async () => {
      const { error } = await sb.from('decks').update({ bracket: n }).eq('id', st.deck.id).select('id').single();
      if (error) { console.warn('Bracket setzen', error.message); toast(t('decklist.bracket.saveFailed')); return; }
      groupData.invalidate(state.groupId); // P12 Nachtrag 1 (B2): eigener Schreibvorgang ⇒ Gruppen-Stand verworfen
      toast(t('decklist.bracket.set', { n }));
      rerender();
    });
  }

  // ---------------------------------------------------------------- Kartenbild
  function openCard(r) {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'dl-zoom';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', r.name);
    mount(wrap, html`<button type="button" class="icon-btn dl-zoom-x" data-close aria-label="${t('decklist.close')}">${icon('close', 22)}</button>
      ${r.image_normal
        ? html`<img class="dl-zoom-img" src="${r.image_normal}" alt="${r.name}" decoding="async">`
        : html`<div class="dl-zoom-none"><b>${r.name}</b><span>${t('decklist.noImage')}</span></div>`}`);
    document.body.append(wrap);
    // „Zurück“ schließt nur das Bild: eigener Verlaufseintrag mit gleicher Adresse (kein hashchange)
    let pushed = false;
    try { history.pushState({ ttgCard: 1 }, ''); pushed = true; } catch { /* ohne Verlauf: nur Tippen/Escape */ }
    const done = () => {
      if (!wrap.isConnected) return;
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', done);
      if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus();
    };
    const close = () => {
      if (!wrap.isConnected) return;
      done();
      if (pushed && history.state?.ttgCard) history.back();
    };
    const onPop = () => { pushed = false; done(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', done);
    wrap.querySelector('[data-close]')?.focus();
  }

  // ---------------------------------------------------------------- Import
  function openImport() {
    if (!st.cards.length) { importSheet(); return; }
    const n = sumQty(st.cards);
    sheet(t('decklist.import.replaceTitle'), html`
      <h2>${t('decklist.import.replaceTitle')}</h2>
      <p class="muted">${t('decklist.import.replaceText', { n })}</p>
      <button type="button" class="btn block" data-act="dl-replace-yes">${t('decklist.import.replaceYes')}</button>
      <button type="button" class="btn soft block" style="background:var(--sf2)" data-act="dl-replace-no">${t('common.cancel')}</button>`, (sh, close) => {
      on(sh, 'click', '[data-act="dl-replace-no"]', close);
      on(sh, 'click', '[data-act="dl-replace-yes"]', () => { close(); importSheet(); });
    });
  }

  function mismatchOf(commanders) {
    if (!commanders.length) return null;
    const own = [st.deck.commander_name, st.deck.partner_name].filter(Boolean);
    if (!own.length) return null;
    const ownKeys = own.map(front);
    const off = commanders.some((c) => !ownKeys.includes(front(c.name)));
    return off ? { found: commanders.map((c) => c.name).join(' & '), deck: own.join(' & ') } : null;
  }

  function importSheet() {
    sheet(t('decklist.import.title'), html`
      <h2>${t('decklist.import.title')}</h2>
      <div class="field"><label for="dl-text">${t('decklist.import.label')}</label>
        <textarea id="dl-text" class="input dl-text" rows="8" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" placeholder="${t('decklist.import.ph')}"></textarea></div>
      <span class="hint">${t('decklist.import.hint')}</span>
      <div class="dl-msgs" data-dl-msg></div>
      <p class="dl-progress" data-dl-progress role="status" hidden></p>
      <button type="button" class="btn block" data-act="dl-go">${icon('uploadSimple', 18)}<span data-dl-golabel>${t('decklist.import.go')}</span></button>`, (sh, close) => {
      const ta = /** @type {HTMLTextAreaElement} */ (sh.querySelector('#dl-text'));
      const msg = sh.querySelector('[data-dl-msg]');
      const prog = /** @type {HTMLElement} */ (sh.querySelector('[data-dl-progress]'));
      const goBtn = /** @type {HTMLButtonElement} */ (sh.querySelector('[data-act="dl-go"]'));
      const goLabel = sh.querySelector('[data-dl-golabel]');
      let stage = 'edit'; // edit · confirm (Warnungen gezeigt) · notfound (aufgelöst, Karten fehlen)
      let pending = null;

      const setLabel = (k) => { goLabel.textContent = t(k); };
      const lock = (on_) => { goBtn.disabled = on_; ta.disabled = on_; if (on_) goBtn.setAttribute('aria-busy', 'true'); else goBtn.removeAttribute('aria-busy'); };
      const progress = (text) => { prog.hidden = !text; prog.textContent = text || ''; };
      const show = (...blocks) => mount(msg, html`${blocks}`);
      const errLine = (text) => html`<p class="error" role="alert" data-dl-err>${text}</p>`;

      ta.addEventListener('input', () => {
        stage = 'edit'; pending = null; setLabel('decklist.import.go'); show(); progress('');
      });

      const warnBlock = (errors) => html`<div class="dl-msg" data-dl-warn>
        <b>${icon('warningCircle', 18)}${t('decklist.import.warnTitle')}</b>
        <ul>${errors.map((e) => html`<li>${e.line
          ? html`<span class="dl-line">${t('decklist.import.line', { n: e.line })}</span> <span class="dl-src">${e.text}</span> · ${t(`decklist.import.errors.${e.code}`)}`
          : t(`decklist.import.errors.${e.code}`)}</li>`)}</ul>
        <span class="small">${t('decklist.import.warnHint')}</span></div>`;
      const mismatchBlock = (m) => html`<p class="dl-msg" data-dl-mismatch>${icon('warn', 18)}<span>${t('decklist.import.mismatch', m)}</span></p>`;
      const notFoundBlock = (nf) => html`<div class="dl-msg" data-dl-notfound="${nf.length}">
        <b>${icon('warningCircle', 18)}${nf.length === 1 ? t('decklist.import.notFoundTitle1') : t('decklist.import.notFoundTitle', { n: nf.length })}</b>
        <ul>${nf.map((e) => html`<li data-nf="${e.name}">${e.qty} · ${e.name}</li>`)}</ul>
        <span class="small">${t('decklist.import.notFoundHint')}</span></div>`;

      async function save(cards) {
        lock(true);
        progress(t('decklist.import.saving'));
        try {
          await saveDeckCards(sb, st.deck.id, cards);
        } catch (ex) {
          if (!sh.isConnected) return;
          lock(false); progress('');
          show(errLine(t('decklist.import.saveError', { msg: ex?.message || '' })));
          return;
        }
        close();
        toast(t('decklist.import.done', { n: sumQty(cards) }));
        if (slot.isConnected) rerender();
      }

      on(sh, 'click', '[data-act="dl-go"]', async () => {
        if (goBtn.disabled) return;
        if (!navigator.onLine) { show(errLine(t('decklist.import.offline'))); return; }
        if (stage === 'notfound' && pending) { await save(pending); return; }

        const parsed = parseManaBox(ta.value);
        const entries = parsed.commanders.length + parsed.main.length;
        if (!entries) {
          const fatal = parsed.errors.find((e) => e.line === 0 && e.code !== 'no_commander');
          show(fatal ? errLine(t(`decklist.import.errors.${fatal.code}`)) : html`${errLine(t('decklist.import.noCards'))}${parsed.errors.length ? warnBlock(parsed.errors) : ''}`);
          return;
        }
        const mismatch = mismatchOf(parsed.commanders);
        if (stage === 'edit' && (parsed.errors.length || mismatch)) {
          show(parsed.errors.length ? warnBlock(parsed.errors) : '', mismatch ? mismatchBlock(mismatch) : '');
          stage = 'confirm';
          setLabel('decklist.import.goAnyway');
          return;
        }

        // Auflösen über Scryfall; Sheet zu ⇒ keine weiteren Anfragen, nichts speichern
        const guarded = (url, opts) => (sh.isConnected
          ? globalThis.fetch(url, opts)
          : Promise.reject(Object.assign(new Error('abgebrochen'), { status: 0 })));
        lock(true);
        progress(t('decklist.import.progress', { done: 0, total: entries }));
        let res;
        try {
          res = await resolveCards(parsed, {
            fetch: guarded,
            onProgress: (done, total) => { if (sh.isConnected) progress(t('decklist.import.progress', { done, total })); },
          });
        } catch (ex) {
          if (!sh.isConnected) return;
          lock(false);
          console.warn('Scryfall', ex?.status ?? '', ex?.message ?? '');
          show(errLine(ex?.status === 429 ? t('decklist.import.scryfallBusy') : t('decklist.import.scryfallError')));
          return; // Fortschritt bleibt stehen (zeigt, wie weit es kam)
        }
        if (!sh.isConnected) return;
        lock(false);
        progress('');
        if (!res.cards.length) {
          show(errLine(t('decklist.import.noCards')), res.notFound.length ? notFoundBlock(res.notFound) : '');
          stage = 'edit';
          setLabel('decklist.import.go');
          return;
        }
        if (res.notFound.length) {
          show(notFoundBlock(res.notFound), mismatch ? mismatchBlock(mismatch) : '');
          stage = 'notfound';
          pending = res.cards;
          setLabel('decklist.import.saveAnyway');
          return;
        }
        await save(res.cards);
      });
    });
  }

  // ---------------------------------------------------------------- Ereignisse (einmal gebunden)
  on(slot, 'click', '[data-act="dl-import"]', () => { if (st.canEdit) openImport(); });
  on(slot, 'click', '[data-act="dl-card"]', (e, b) => { const r = st.cards[Number(b.dataset.i)]; if (r) openCard(r); });
  on(slot, 'click', '[data-act="dl-check"]', () => { runCheck(); });
  on(slot, 'click', '[data-act="dl-set"]', (e, b) => { if (st.canEdit) setBracket(b); });
  const onNet = () => {
    if (!slot.isConnected) { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); return; }
    drawBracket();
  };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);

  draw();
}
