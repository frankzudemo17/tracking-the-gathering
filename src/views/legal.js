// Über die App: Rechtliches & Credits (#/einstellungen/rechtliches) und Datenschutz (#/datenschutz).
// Beide öffentlich (auch ohne Anmeldung erreichbar), daher ohne state.profile.
import { state } from '../state.js';
import { html, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead } from '../lib/parts.js';
import { t } from '../i18n/index.js';
import { APP_VERSION } from '../version.js';

// Angaben von Franco (WELLE E5, 10.11.2026). Solange ein Wert mit {{ beginnt,
// zeigt die App sichtbar „Angaben folgen“ statt erfundener Daten.
const ANGABEN = '{{entfernt}}';
const VERANTWORTLICHER = ANGABEN;
const IMPRESSUM = ANGABEN;
const filled = (v) => !/^\{\{.*\}\}$/.test(v);
const pendingOr = (v) => (filled(v) ? html`<p class="pre">${v}</p>` : html`<p class="pending" data-pending>${icon('warn', 16)}${t('legal.pending')}</p>`);

const FAN_URL = 'https://company.wizards.com/de/legal/fancontentpolicy';
const back = () => (state.session ? '#/einstellungen' : '#/login');

function legalPage(el) {
  mount(el, html`
    ${backHead(t('legal.title'), back())}

    <section class="card legal" aria-labelledby="fan-h">
      <h3 class="section-title" id="fan-h">${t('legal.fanTitle')}</h3>
      <p data-fan>${t('legal.fan')}</p>
      <a class="link acc" href="${FAN_URL}" target="_blank" rel="noopener noreferrer">${t('legal.fanLink')}${icon('arrowRight', 16)}</a>
    </section>

    <section class="section" aria-labelledby="cred-h">
      <div class="section-head"><h3 class="section-title" id="cred-h">${t('legal.creditsTitle')}</h3></div>
      <div class="list">
        <a class="row" href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
          <span class="row-ic">${icon('image', 20)}</span>
          <span class="grow"><span class="title">Scryfall</span><span class="sub">${t('legal.scryfall')}</span></span>
          <span class="chev">${icon('chevRight', 18)}</span>
        </a>
        <a class="row" href="https://phosphoricons.com" target="_blank" rel="noopener noreferrer">
          <span class="row-ic">${icon('crown', 20)}</span>
          <span class="grow"><span class="title">${t('legal.icons')}</span><span class="sub">${t('legal.iconsLic')}</span></span>
          <span class="chev">${icon('chevRight', 18)}</span>
        </a>
        <div class="row static">
          <span class="row-ic">${icon('edit', 20)}</span>
          <span class="grow"><span class="title">${t('legal.fonts')}</span><span class="sub wrap">${t('legal.fontsLic')}</span></span>
        </div>
      </div>
    </section>

    <section class="card legal" aria-labelledby="imp-h">
      <h3 class="section-title" id="imp-h">${t('legal.imprintTitle')}</h3>
      ${pendingOr(IMPRESSUM)}
    </section>

    <div class="list">
      <a class="row" href="#/datenschutz">
        <span class="row-ic">${icon('lock', 20)}</span>
        <span class="grow"><span class="title">${t('legal.privacyLink')}</span></span>
        <span class="chev">${icon('chevRight', 18)}</span>
      </a>
    </div>

    <p class="muted tiny center" data-version>${t('legal.version', { v: APP_VERSION })}</p>`);
}

function privacyPage(el) {
  const sections = t('privacy.sections');
  mount(el, html`
    ${backHead(t('privacy.title'), state.session ? '#/einstellungen' : '#/login')}
    <p class="muted small">${t('privacy.updated')}</p>
    <p>${t('privacy.intro')}</p>

    <section class="card legal" aria-labelledby="ctl-h">
      <h3 class="section-title" id="ctl-h">${t('privacy.controllerTitle')}</h3>
      ${pendingOr(VERANTWORTLICHER)}
    </section>

    ${(Array.isArray(sections) ? sections : []).map((s, i) => html`
      <section class="card legal" aria-labelledby="ps-${i}">
        <h3 class="section-title" id="ps-${i}">${s.h}</h3>
        ${s.p.map((p) => html`<p>${p}</p>`)}
      </section>`)}`);
}

export default function legal(el, { arg } = {}) {
  if (arg === 'privacy') privacyPage(el);
  else legalPage(el);
}
