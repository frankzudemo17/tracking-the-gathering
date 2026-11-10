// Live-Beitritt per Code/Link (#/beitreten, #/beitreten/:code) · Platzhalter aus P3 (Naht).
// Gehört P6 der Welle ttg-live-feinschliff-decks: P6 ersetzt diese Datei. Ohne Anmeldung erreichbar.
import { html, mount } from '../lib/dom.js';
import { empty } from '../lib/parts.js';
import { t } from '../i18n/index.js';

export default function join(el) {
  mount(el, html`<h2 class="title-xl">${t('home.joinGame')}</h2>
    <div class="card">${empty('live', t('groups.joinLiveSoon'), t('groups.joinLiveSoonSub'))}</div>`);
}
