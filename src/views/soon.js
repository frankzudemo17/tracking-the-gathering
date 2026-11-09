// Platzhalter für Bereiche späterer Etappen
import { html, mount } from '../lib/dom.js';
import { empty } from '../lib/parts.js';
import { t } from '../i18n/index.js';

const ICON = { play: 'play', history: 'history', board: 'trophy' };

export default function soon(el, { arg }) {
  mount(el, html`<h2 class="title-xl">${t(`nav.${arg}`)}</h2><div class="card">${empty(ICON[arg], t(`soon.${arg}.title`), t(`soon.${arg}.sub`))}</div>`);
}
