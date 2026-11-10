// Ausscheide-Ablauf (Spec P8, einfache Fassung ohne Animation). P11 ersetzt diese Datei durch die
// animierten K.O.-Screens A/B/C — die Schnittstelle bleibt dieselbe:
//
//   showKo(host, { player, deck, by, pick, candidates, onEliminate, onCancel })
//     player      { id, name }                        wer tödlich ist
//     deck        decks-Zeile oder null               Commander-Bild(er)
//     by          member_id | null                    bekannter Verursacher (Angriff), sonst null
//     pick        { variant, quote } aus koPick()      P8 zeigt nur den Spruch
//     candidates  [{ id, name, damage, poison, top }]  aus engine.killerCandidates, Namen dazu
//     onEliminate(byId | null)                         „Ausscheiden“ bzw. Auswahl / „Aufgegeben“ (null)
//     onCancel()                                       „Doch nicht“ oder Sheet anders geschlossen
//
// Genau einer der beiden Rückrufe wird genau einmal aufgerufen. `host` bleibt für P11 (Vollbild
// im Lifecounter); das Sheet der P8-Fassung hängt wie alle Sheets am body.
import { html, mount, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { sheet } from '../lib/ui.js';
import { t } from '../i18n/index.js';

const cssUrl = (u) => `url('${String(u).replace(/'/g, '%27')}')`;

export function showKo(host, { player, deck = null, by = null, pick = null, candidates = [], onEliminate, onCancel }) {
  let done = false;
  let ask = false;
  const finish = (fn, arg) => { if (done) return; done = true; fn?.(arg); };
  const nameOf = (id) => candidates.find((c) => c.id === id)?.name ?? '';
  const quotes = t('ko.quotes');
  const quote = Array.isArray(quotes) && pick ? quotes[pick.quote] ?? '' : '';
  const arts = [deck?.image_url, deck?.partner_image_url].filter(Boolean);

  const body = () => {
    if (ask) {
      return html`<div class="su-sh-head"><span class="t"><h3>${t('ko.whoTitle', { name: player.name })}</h3><small>${t('ko.whoSub')}</small></span></div>
        <div class="lc-opps">${candidates.map((c) => html`<button type="button" class="lc-pill ${c.top ? 'top' : ''}" data-ko="by" data-by="${c.id}">
          ${c.top ? icon('crown', 15) : ''}<span>${c.name}</span><small class="num">${c.poison && !c.damage ? t('ko.poison', { n: c.poison }) : t('ko.damage', { n: c.damage })}</small></button>`)}
          <button type="button" class="lc-pill dash" data-ko="gaveup">${icon('flag', 15)}<span>${t('ko.gaveUp')}</span></button></div>
        <button type="button" class="btn soft" data-ko="back">${t('ko.back')}</button>`;
    }
    return html`<div class="lc-ko">
        <div class="lc-ko-art">${arts.map((u) => html`<i style="--img:${cssUrl(u)}"></i>`)}</div>
        <span class="lc-ko-ic">${icon('skull', 34)}</span>
        <h3>${t('ko.title')}</h3><b>${player.name}</b>
        ${quote ? html`<p>${quote}</p>` : ''}
      </div>
      <div class="lc-ko-btns">
        <button type="button" class="btn outline" data-ko="cancel">${t('ko.cancel')}</button>
        ${by != null
          ? html`<button type="button" class="btn" data-ko="out">${icon('skull', 18)}${t('ko.out')}</button>`
          : html`<button type="button" class="btn" data-ko="ask">${t('ko.who')}</button>`}
      </div>
      ${by != null ? html`<small class="lc-ko-by">${t('ko.by', { name: nameOf(by) })}</small>` : ''}`;
  };

  const close = sheet(t('ko.label', { name: player.name }), html`<div class="su-sheet lc-ko-sheet" data-sheet="ko">${body()}</div>`, (sh, closeSheet) => {
    const box = $('[data-sheet="ko"]', sh);
    const wrap = sh.closest('.sheet-wrap');
    // Schließen über Hintergrund, Escape oder Seitenwechsel zählt als „Doch nicht“
    const mo = new MutationObserver(() => { if (!wrap.isConnected) { mo.disconnect(); finish(onCancel); } });
    mo.observe(document.body, { childList: true });
    sh.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ko]');
      if (!b) return;
      const k = b.dataset.ko;
      if (k === 'ask') { ask = true; mount(box, body()); return; }
      if (k === 'back') { ask = false; mount(box, body()); return; }
      if (k === 'cancel') { closeSheet(); return; } // Observer meldet onCancel
      const arg = k === 'out' ? by : k === 'by' ? b.dataset.by : null;
      done = true; mo.disconnect(); closeSheet();
      onEliminate?.(arg);
    });
  });
  return close;
}
