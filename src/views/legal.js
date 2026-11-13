// Über die App: Rechtliches & Credits (#/einstellungen/rechtliches) und Datenschutz (#/datenschutz).
// Beide öffentlich (auch ohne Anmeldung erreichbar), daher ohne state.profile.
//
// Impressum/Verantwortlich (P10, spec-p10-impressum.md Entscheid 4): die Anbieterangaben stehen nie im Code, sondern in
// der Tabelle app_info (Schlüssel „impressum“, lesbar nur für angemeldete, nicht anonyme Konten). Mit Sitzung genau eine
// Leseanfrage je Seitenaufruf, währenddessen ein ruhiger Platzhalter; ohne Sitzung, ohne Zeile oder bei Fehler der
// neutrale Satz (legal.operator), ohne Sitzung dazu der Hinweis legal.membersOnly. Der Wert wird nirgends gespeichert.
// state.js und supabase.js lädt die Seite erst beim Zeichnen (beide längst geladen): so bleiben pickImprint und
// loadImprint in Node testbar (tests/unit/legal.test.mjs; supabase.js ist in Node nicht ladbar, tests/unit/README.md).
import { html, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead } from '../lib/parts.js';
import { t } from '../i18n/index.js';
import { APP_VERSION } from '../version.js';

const FAN_URL = 'https://company.wizards.com/de/legal/fancontentpolicy';
const back = (signedIn) => (signedIn ? '#/einstellungen' : '#/login');

/**
 * Was der Abschnitt zeigt (rein). Wert nur mit Sitzung, ohne Fehler und mit nicht leerem Text.
 * @param {any} session  state.session (null = abgemeldet)
 * @param {{ value?: unknown }|null|undefined} row  Antwortzeile von app_info (oder null)
 * @param {unknown} error  Fehler der Anfrage (oder null)
 * @returns {{ value: string|null, hint: boolean }}  value null ⇒ neutraler Satz; hint ⇒ legal.membersOnly dazu
 */
export function pickImprint(session, row, error) {
  if (!session) return { value: null, hint: true };
  if (error || !row || typeof row.value !== 'string' || row.value.trim() === '') return { value: null, hint: false };
  return { value: row.value, hint: false };
}

/**
 * Genau eine Leseanfrage an app_info (Schlüssel „impressum“). Wirft nie: Netz-/Schnittstellenfehler (auch 404 vor dem
 * db push, 401) kommen als `error` zurück — die Seite bleibt dann still neutral (keine Konsole, kein Abmelden).
 * retry(false): postgrest-js wiederholt GET sonst bei Netzfehler bis zu dreimal mit Wartezeit (Probe: 4 Versuche,
 * Platzhalter 7 s) — hier genau ein Versuch, danach sofort der neutrale Satz.
 * @param {any} sb  Supabase-Client
 * @returns {Promise<{ row: any, error: unknown }>}
 */
export async function loadImprint(sb) {
  try {
    const { data, error } = await sb.from('app_info').select('value').eq('key', 'impressum').maybeSingle().retry(false);
    return { row: data ?? null, error: error ?? null };
  } catch (e) {
    return { row: null, error: e };
  }
}

/** Inhalt des Abschnitts: Wert als vorformatierter Text (escaped über html``) oder neutraler Satz (+ Hinweis). */
function imprintBody({ value, hint }) {
  if (value !== null) return html`<p class="pre" data-imprint-value>${value}</p>`;
  return html`<p data-operator>${t('legal.operator')}</p>${hint ? html`<p class="muted" data-members-only>${t('legal.membersOnly')}</p>` : ''}`;
}

/** Abschnitt „Impressum“/„Verantwortlich“: mit Sitzung zuerst der Platzhalter (kein Blitz des neutralen Satzes). */
function imprintSection(id, title, signedIn) {
  return html`
    <section class="card legal" aria-labelledby="${id}" data-imprint${signedIn ? html` aria-busy="true"` : ''}>
      <h3 class="section-title" id="${id}">${title}</h3>
      <div class="imprint-slot" data-imprint-slot>${signedIn
        ? html`<p class="imprint-wait" data-imprint-wait aria-hidden="true"><span></span></p>`
        : imprintBody(pickImprint(null, null, null))}</div>
    </section>`;
}

function legalPage(el, signedIn) {
  mount(el, html`
    ${backHead(t('legal.title'), back(signedIn))}

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

    ${imprintSection('imp-h', t('legal.imprintTitle'), signedIn)}

    <div class="list">
      <a class="row" href="#/datenschutz">
        <span class="row-ic">${icon('lock', 20)}</span>
        <span class="grow"><span class="title">${t('legal.privacyLink')}</span></span>
        <span class="chev">${icon('chevRight', 18)}</span>
      </a>
    </div>

    <p class="muted tiny center" data-version>${t('legal.version', { v: APP_VERSION })}</p>`);
}

function privacyPage(el, signedIn) {
  const sections = t('privacy.sections');
  mount(el, html`
    ${backHead(t('privacy.title'), back(signedIn))}
    <p class="muted small">${t('privacy.updated')}</p>
    <p>${t('privacy.intro')}</p>

    ${imprintSection('ctl-h', t('privacy.controllerTitle'), signedIn)}

    ${(Array.isArray(sections) ? sections : []).map((s, i) => html`
      <section class="card legal" aria-labelledby="ps-${i}">
        <h3 class="section-title" id="ps-${i}">${s.h}</h3>
        ${s.p.map((p) => html`<p>${p}</p>`)}
      </section>`)}`);
}

/**
 * Antwort in den Abschnitt setzen — nur, wenn dieser Seitenaufruf noch gilt (Routenwechsel/Abmelden dazwischen ⇒
 * nichts). Der Wert lebt nur im DOM dieses Aufrufs (kein Modul-Zustand, kein Speicher).
 * @param {HTMLElement} el @param {{ sb: any, state: any, isStale: () => boolean }} o
 */
async function fillImprint(el, { sb, state, isStale }) {
  const uid = state.session?.user?.id;
  const { row, error } = await loadImprint(sb);
  const sec = el.querySelector('[data-imprint]');
  const slot = sec?.querySelector('[data-imprint-slot]');
  if (isStale() || !slot || !slot.isConnected) return;
  const same = state.session && state.session.user?.id === uid;
  mount(slot, imprintBody(same ? pickImprint(state.session, row, error) : pickImprint(null, null, null)));
  sec.removeAttribute('aria-busy');
}

/** @param {HTMLElement} el @param {{ arg?: string, isStale?: () => boolean }} [ctx] */
export default async function legal(el, { arg, isStale = () => false } = {}) {
  const [{ state }, { sb }] = await Promise.all([import('../state.js'), import('../supabase.js')]);
  const signedIn = !!state.session && !!sb;
  if (arg === 'privacy') privacyPage(el, signedIn);
  else legalPage(el, signedIn);
  // nicht abwarten: render() rollt nach dem Zeichnen nach oben — die Antwort ersetzt nur den Platzhalter
  if (signedIn) void fillImprint(el, { sb, state, isStale });
}
