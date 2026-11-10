// Wiederkehrende UI-Teile
import { html, initials, mount } from './dom.js';
import { icon } from './icons.js';
import { t, getLang } from '../i18n/index.js';
import { pageCache, cacheKey } from './cache.js';
import { toast } from './ui.js';

/** Runder Avatar: Foto, sonst Initialen. ring = Farbring (z. B. Spielerfarbe), color = CSS-Farbe. */
export function avatar({ name, url, size = 44, ring = false, color = '' }) {
  const style = `--av:${size}px;${color ? `--c:${color};` : ''}${url ? `background-image:url('${String(url).replace(/'/g, '%27')}');` : ''}`;
  return html`<span class="avatar ${ring ? 'ring' : ''}" style="${style}" aria-hidden="true">${url ? '' : initials(name)}</span>`;
}

export function backHead(title, href = '#/start') {
  return html`<div class="head">
    <a class="icon-btn" href="${href}" aria-label="${t('common.back')}">${icon('back', 20)}</a>
    ${title ? html`<h2>${title}</h2>` : ''}
  </div>`;
}

export const manaPips = (colors = ['W', 'U', 'B', 'R', 'G'], size = 12) =>
  html`<span class="pips" aria-hidden="true">${colors.map((c) => html`<span class="pip ${c}" style="width:${size}px;height:${size}px"></span>`)}</span>`;

export function empty(iconName, title, sub) {
  return html`<div class="empty"><span class="ic">${icon(iconName, 26)}</span><b>${title}</b>${sub ? html`<span>${sub}</span>` : ''}</div>`;
}

export const roleChip = (m) => {
  if (m.removed_at) return html`<span class="chip guest removed">${t('memberRemove.chip')}</span>`; // P10
  if (!m.profile_id) return html`<span class="chip guest">${t('groups.roles.guest')}</span>`;
  if (m.role === 'admin') return html`<span class="chip admin">${icon('shield', 13)}${t('groups.roles.admin')}</span>`;
  return html`<span class="chip">${t('groups.roles.member')}</span>`;
};

/** Anzeigename eines Mitglieds: bei Konten der Profilname, sonst der Platzhaltername */
export const memberName = (m) => m.profiles?.display_name || m.display_name;
export const memberAvatarPath = (m) => (m.profile_id ? m.profiles?.avatar_path : m.avatar_path) || null;

export function loading() { return html`<div class="loading" aria-label="${t('common.loading')}"><span class="spinner"></span></div>`; }

// ---------------------------------------------------------------------------
// P12 Tempo Seitenwechsel: gemerkter Stand sofort, Auffrischen im Hintergrund (spec-p12-seitenwechsel.md).
// Nur reine Importe (cache.js, ui.js): history-data.js importiert diese Datei und wird in Node getestet.

/**
 * Eintrag sofort aus dem Speicher; neu laden, wenn er fehlt, gescheitert ist, älter als `maxAge` ist (0 ⇒ bei
 * jedem Besuch) oder `fits(value)` falsch liefert. Läuft schon eine Ladung, hängt sich der Besuch an
 * (höchstens eine Ladung je Schlüssel); sonst erzwingt ein vorhandener Wert das Neuladen.
 * @param {string|null} key
 * @param {(opts: { force: boolean }) => Promise<any>} load
 * @param {{ maxAge?: number, fits?: (value: any) => boolean }} [o]
 * @returns {{ cached: { value: any, at: number, failed: boolean } | undefined, promise: Promise<any> | null }}
 */
export function fromCache(key, load, { maxAge = 0, fits } = {}) {
  const cached = pageCache.peek(key);
  const due = !cached || cached.failed || Date.now() - cached.at >= maxAge || (fits ? !fits(cached.value) : false);
  return { cached, promise: due ? load({ force: !!cached && !pageCache.pending(key) }) : null };
}

/**
 * Konto + Gruppe beim Start eines Views (Riegel 14b): `ok()` ist nur wahr, solange der View aktuell ist und
 * Konto und Gruppe dieselben sind. `key(name)` = Speicher-Schlüssel dieses Kontos und dieser Gruppe.
 * @param {{ session: any, groupId: string|null, profile?: any }} st  der App-Zustand (src/state.js)
 * @param {() => boolean} isStale
 */
export function viewScope(st, isStale) {
  const uid = st.session?.user?.id || null;
  const gid = st.groupId || null;
  return {
    uid, gid,
    key: (/** @type {string} */ name) => cacheKey(uid, gid, name),
    ok: () => !isStale() && (st.session?.user?.id || null) === uid && (st.groupId || null) === gid,
  };
}

/** Gruppen-Daten passen nicht mehr, wenn der eigene Name dort ein anderer ist als im Profil (eigenes Umbenennen). */
export const ownNameFits = (/** @type {any} */ st) => (/** @type {any} */ d) => {
  const me = st.profile ? (d?.members || []).find((m) => m.profileId === st.profile.id) : null;
  return !me || me.name === st.profile.display_name;
};

/** Wert, wenn das Promise schon erfüllt ist (Bild-Adressen aus dem Speicher), sonst `undefined` — wartet nie aufs Netz. */
export function settled(promise) {
  return Promise.race([promise, new Promise((r) => { setTimeout(() => r(undefined), 0); })]);
}

/** Merkmal eines fokussierten Bedienelements, um es nach dem Neuzeichnen wiederzufinden. */
function focusSel(el) {
  const a = document.activeElement;
  if (!a || a === el || !el.contains(a)) return null;
  const skip = new Set(['class', 'style', 'aria-pressed', 'aria-current', 'aria-expanded', 'tabindex', 'aria-busy', 'disabled', 'title', 'aria-label']);
  const attrs = [...a.attributes].filter((x) => !skip.has(x.name)).map((x) => `[${x.name}="${CSS.escape(x.value)}"]`).join('');
  return `${a.tagName.toLowerCase()}${attrs}`;
}

/**
 * Zeichnet `#view` (Entscheid 9): gleicher Inhalt ⇒ DOM bleibt unberührt; anderer Inhalt ⇒ neu gezeichnet,
 * Scroll-Position bleibt, Fokus bleibt auf demselben Bedienelement (sonst auf #view). Nie scrollTo(0, 0).
 * `busy: true` (Gerüst, erster Stand fehlt noch) lässt aria-busy stehen, sonst wird es entfernt.
 * @param {HTMLElement} el
 */
export function painter(el) {
  let last = null;
  return (/** @type {any} */ content, { busy = false } = {}) => {
    const s = String(content);
    if (busy) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
    if (s === last) return false;
    const y = window.scrollY;
    const sel = focusSel(el);
    mount(el, content);
    last = s;
    if (sel) {
      const back = el.querySelector(sel);
      if (back) back.focus({ preventScroll: true });
      else { el.tabIndex = -1; el.focus({ preventScroll: true }); }
    }
    if (window.scrollY !== y) window.scrollTo(0, y);
    return true;
  };
}

// Ausfallserie App-weit: ein Toast beim ersten gescheiterten Auffrischen nach dem letzten Erfolg (Entscheid 15).
let failing = false;
const hhmm = (at) => new Date(at).toLocaleTimeString(getLang() === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' });

/**
 * Zustand „nicht aktualisiert“ je Seitenbesuch: `bad(at)` setzt #view[data-stale="1"] (+ Toast einmal je Serie),
 * `good()` nimmt ihn zurück, solange in diesem Besuch nichts gescheitert ist.
 * @param {HTMLElement} el
 */
export function staleMark(el) {
  let failed = false;
  return {
    bad(/** @type {number} */ at) {
      failed = true;
      el.setAttribute('data-stale', '1');
      if (!failing) { failing = true; toast(t('common.stale', { time: hhmm(at) })); }
    },
    good() {
      if (failed) return;
      failing = false;
      el.removeAttribute('data-stale');
    },
  };
}

/** Gerüst-Bausteine (aria-hidden, keine Inhalts-Marken der Seiten). */
export const skel = {
  line: (short = false) => html`<span class="skel skel-line ${short ? 'short' : ''}" aria-hidden="true"></span>`,
  block: (tall = false) => html`<div class="skel-block ${tall ? 'tall' : ''}" data-skel aria-hidden="true"></div>`,
  people: (n = 5) => html`<div class="skel-people" data-skel aria-hidden="true">${Array.from({ length: n }, () =>
    html`<span class="skel-person"><span class="skel skel-av"></span><span class="skel skel-line"></span></span>`)}</div>`,
  rows: (n = 4) => html`<div class="skel-list" data-skel aria-hidden="true">${Array.from({ length: n }, () =>
    html`<div class="card skel-row"><span class="skel skel-av sm"></span><span class="grow-col"><span class="skel skel-line"></span><span class="skel skel-line short"></span></span></div>`)}</div>`,
};
