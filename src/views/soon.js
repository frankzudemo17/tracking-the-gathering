// Platzhalter für Bereiche späterer Etappen
import { html, mount } from '../lib/dom.js';
import { empty } from '../lib/parts.js';
import { t } from '../i18n/index.js';

const ICON = { play: 'play', history: 'history', board: 'trophy' };

export default function soon(el, { arg }) {
  mount(el, html`<h2>${t(`nav.${arg}`)}</h2>${empty(ICON[arg], t(`soon.${arg}.title`), t(`soon.${arg}.sub`))}`);
}
