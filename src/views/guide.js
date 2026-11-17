// Anleitung „So funktioniert’s“ (#/einstellungen/anleitung, P7 Welle ttg-features): stellt die App vor und erklärt jede
// Funktion in wenigen Punkten. Vier Gruppen, je Funktion ein aufklappbarer Eintrag (<details>, ohne eigenes Skript).
// Texte nur in src/i18n/*-guide.js; die Reihenfolge steht hier.
import { html, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead } from '../lib/parts.js';
import { t } from '../i18n/index.js';

/** Gruppen und Einträge (Schlüssel in guide.items) mit Symbol, in Lesereihenfolge. */
export const GUIDE = [
  ['before', [['install', 'deviceMobile'], ['group', 'users'], ['decks', 'cards']]],
  ['table', [['setup', 'plus'], ['intro', 'quotes'], ['life', 'heart'], ['attack', 'sword'], ['ko', 'skull'], ['end', 'flag']]],
  ['after', [['points', 'trophy'], ['history', 'history'], ['profile', 'chartBar'], ['badges', 'medal']]],
  ['more', [['settings', 'gear'], ['offline', 'wifiSlash']]],
];

/** Seiteninhalt (rein, ohne DOM; Test tests/unit/guide.test.mjs). */
export function guideHtml() {
  return html`
    ${backHead(t('guide.title'), '#/einstellungen')}
    <p class="guide-lead">${t('guide.lead')}</p>
    ${GUIDE.map(([g, items]) => html`<div class="section">
      <div class="section-head"><h3 class="section-title">${t(`guide.groups.${g}`)}</h3></div>
      <div class="list guide-list">${items.map(([k, ic]) => {
        const body = /** @type {string[]} */ (/** @type {unknown} */ (t(`guide.items.${k}.body`)));
        return html`<details class="guide-item" data-guide="${k}">
          <summary class="row"><span class="row-ic">${icon(ic, 20)}</span><span class="grow"><span class="title">${t(`guide.items.${k}.title`)}</span><span class="sub">${t(`guide.items.${k}.sub`)}</span></span><span class="chev">${icon('chevDown', 18)}</span></summary>
          <ul>${(Array.isArray(body) ? body : []).map((p) => html`<li>${p}</li>`)}</ul>
        </details>`;
      })}</div>
    </div>`)}`;
}

export default function guide(el) {
  mount(el, guideHtml());
}
