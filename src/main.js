// Start, Router, Auth-Status
import { sb, configured } from './supabase.js';
import { state, loadMe, applyPrefs, pendingCode, clearCaches } from './state.js';
import { route, current, go } from './router.js';
import { html, mount, $ } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { loading } from './lib/parts.js';
import { t } from './i18n/index.js';
import { applyDevicePrefs, onPrefs, keepAwake } from './lib/prefs.js';
import { setupSwUpdate } from './lib/sw-update.js';
import { pageCache } from './lib/cache.js';

// ---------- Routen ----------
const v = (name) => () => import(`./views/${name}.js`);
route('/login', v('login'), { public: true, swap: true });
route('/registrieren', v('register'), { public: true });
route('/passwort-vergessen', v('forgot'), { public: true });
route('/passwort-neu', v('newpass'));
route('/code/:code', v('join'), { public: true });
route('/willkommen', v('welcome'));
// Spielende, Historie, Statistik (Etappe 4/5, Naht P13).
route('/historie', v('history'), { nav: 'history', group: true, arg: 'history', swap: true });
route('/rangliste', v('board'), { nav: 'board', group: true, arg: 'board', swap: true });
route('/partie/:id', v('game-detail'), { nav: 'history', group: true, arg: 'history' });
route('/abend/:id', v('recap'), { nav: 'history', group: true, arg: 'history' });
route('/spiel/:id/ende', v('result'), { group: true, arg: 'history' });
route('/start', v('start'), { nav: 'start', group: true, swap: true });
route('/spielen', v('setup'), { nav: 'play', group: true });
route('/profil', v('profile'), { nav: 'me', group: true, swap: true });
route('/profil/:memberId', v('profile'), { nav: 'me', group: true, swap: true });
route('/gruppen', v('groups'), { swap: true });
route('/einstellungen', v('settings'), { nav: 'me', swap: true });
route('/einstellungen/konto', v('settings-account'), { nav: 'me' });
route('/einstellungen/verwaltung', v('admin'), { nav: 'me' });
// Rechtliches und Datenschutz auch ohne Anmeldung lesbar (ohne Navigationsleiste)
route('/einstellungen/rechtliches', v('legal'), { public: true, swap: true });
route('/datenschutz', v('legal'), { public: true, arg: 'privacy', swap: true });
route('/spieler-neu', v('add-player'), { group: true });
route('/deck-neu/:memberId', v('add-deck'), { group: true });
route('/deck/:id', v('deck'), { nav: 'me', group: true });
// Spielen (Etappe 3, P8 schaltet frei): /spielen (Nav) und /spiel-neu zeigen das Setup, /spiel/:id den Lifecounter.
route('/spiel-neu', v('setup'), { group: true });
route('/spiel/:id', v('life'), { group: true });
route('/beitreten', v('join'), { public: true }); // Naht P3: Platzhalter, P6 ersetzt join.js (Live-Beitritt)
route('/beitreten/:code', v('join'), { public: true });

const NAV = [
  ['start', '#/start', 'home'], ['play', '#/spielen', 'play'], ['history', '#/historie', 'history'],
  ['board', '#/rangliste', 'trophy'], ['me', '#/profil', 'user'],
];
// Aktiver Tab zeigt das gefüllte Icon
// P12: Tab-Routen (Entscheid 10) und Routen, die sofort gemerkten Stand oder Gerüst zeichnen.
// Getrennt von den Routen-Optionen gehalten, damit der Naht-Block (Test K1) unverändert bleibt.
const TABS = new Set(['/start', '/spielen', '/historie', '/rangliste', '/profil']);
const SKELETON = new Set(['/start', '/historie', '/rangliste', '/profil']);
const bare = (/** @type {string} */ p) => p.replace(/\/$/, '') || '/';
// statt des Lade-Kreises (Entscheid 7) — der View meldet ein Scheitern des ersten Ladens über ctx.fail(e).

const app = $('#app');
let renderToken = 0;
// Passwort-Link aus der Mail: ?reset=1&code=… (synchron merken, bevor supabase-js die URL aufräumt)
const cameFromReset = new URLSearchParams(location.search).has('reset');

function navHtml(active) {
  return html`<nav class="nav" aria-label="Hauptnavigation">${NAV.map(([k, href, ic]) =>
    html`<a href="${href}" ${active === k ? html`aria-current="page"` : ''}>${icon(active === k ? ic + 'Fill' : ic, 23)}<span>${t(`nav.${k}`)}</span></a>`)}</nav>`;
}

/** P12: Leiste bleibt derselbe Knoten — nur aria-current, Icon und (nach Sprachwechsel) Beschriftung wechseln. */
function syncNav(nav, active) {
  const links = nav.querySelectorAll(':scope > a');
  NAV.forEach(([k, , ic], i) => {
    const a = links[i];
    if (!a) return;
    const on = active === k;
    if (on !== (a.getAttribute('aria-current') === 'page')) {
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      const tmp = document.createElement('span');
      mount(tmp, icon(on ? ic + 'Fill' : ic, 23));
      const svg = a.querySelector('svg');
      if (svg && tmp.firstElementChild) svg.replaceWith(tmp.firstElementChild);
    }
    const label = a.querySelector('span');
    if (label && label.textContent !== t(`nav.${k}`)) label.textContent = t(`nav.${k}`);
  });
}

/** P12 Entscheid 7: neuer #view je Seitenwechsel, die Leiste bleibt stehen. */
function frame(r) {
  const view = document.createElement('main');
  view.id = 'view';
  view.className = `screen ${r.opts.nav ? 'with-nav' : ''}`;
  if (SKELETON.has(bare(r.path))) view.setAttribute('aria-busy', 'true');
  else mount(view, loading());
  const old = app.querySelector(':scope > #view');
  let nav = r.opts.nav ? app.querySelector(':scope > nav.nav') : null;
  if (nav) syncNav(nav, r.opts.nav);
  else if (r.opts.nav) { const tmp = document.createElement('div'); mount(tmp, navHtml(r.opts.nav)); nav = tmp.firstElementChild; }
  for (const c of [...app.children]) if (c !== old && c !== nav) c.remove();
  if (old) old.replaceWith(view); else app.prepend(view);
  if (nav && nav.parentNode !== app) app.append(nav);
  return view;
}

/** Fehlerweg wie bisher: Fehlerblock in #view, Leiste bleibt. */
function showError(e) {
  const view = $('#view');
  if (!view) return;
  view.removeAttribute('aria-busy');
  mount(view, html`<div class="empty"><b>${t('common.error')}</b><span class="small">${e?.message || ''}</span>
        <button class="btn outline" type="button" data-reload>${t('common.reload')}</button></div>`);
  $('#view [data-reload]')?.addEventListener('click', () => location.reload());
}

// P12 Entscheid 10: page:*-Einträge überleben nur den Wechsel Tab-Route → andere Tab-Route.
let lastPath = null;
let lastTab = false;
function tabRule(r) {
  const tab = TABS.has(bare(r.path));
  const keep = lastTab && tab && lastPath !== bare(r.path);
  lastPath = bare(r.path); lastTab = tab;
  // P6 Entscheid 8: nur Arbeitsspeicher — im Gerätespeicher erfüllt die Schreibmarke diesen Zweck genauer
  if (!keep) pageCache.drop((p) => p.name.startsWith('page:'), { keepStored: true });
}

// Ein View-Modul ließ sich nicht laden (Netz kurz weg oder neue Version mitten im Betrieb):
// einmal von selbst neu laden; passiert es binnen 30 s wieder, den Fehler zeigen (keine Schleife).
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem('ttg.reload') || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem('ttg.reload', String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}

export async function render() {
  const token = ++renderToken;
  const r = current();
  if (!r) return go('/start', { replace: true });

  // Zugriffsregeln
  if (!state.session && !r.opts.public) return go('/login', { replace: true });
  if (state.session && ['/login', '/registrieren'].includes(r.path)) return go('/start', { replace: true });
  if (state.session && r.opts.group && !state.groupId) return go('/willkommen', { replace: true });

  tabRule(r);
  frame(r);
  const isStale = () => token !== renderToken;
  const fail = (e) => { console.error(e); if (!isStale()) showError(e); };
  try {
    let mod;
    const sw = swNext(r.opts.swap === true); if (sw !== 'go' && (await sw) === 'reload') return; // P11: neue Version nur an ruhiger Stelle
    try { mod = await r.load(); } catch (e) { if (reloadOnce()) return; throw e; }
    if (token !== renderToken) return;
    const view = $('#view');
    await mod.default(view, { params: r.params, arg: r.opts.arg, isStale, fail });
    if (token === renderToken) { view.focus?.({ preventScroll: true }); window.scrollTo(0, 0); }
  } catch (e) {
    console.error(e);
    if (token === renderToken) showError(e);
  }
}

// ---------- Start ----------
async function boot() {
  applyPrefs(null);
  // Tisch-Einstellungen (P7): html[data-motion]/[data-turntime] und Wake Lock auf /spiel/…, je Gerät (src/lib/prefs.js)
  applyDevicePrefs();
  const awake = keepAwake(() => location.hash.startsWith('#/spiel/'));
  onPrefs((p) => { applyDevicePrefs(p); awake.check(); });
  window.addEventListener('hashchange', awake.check);
  document.addEventListener('visibilitychange', awake.check);
  awake.check();
  if (!configured) { mount(app, html`<main class="screen"><p>Supabase ist noch nicht konfiguriert (src/config.js).</p></main>`); return; }

  // Nach Klick auf einen Passwort-Link: ?code=… wird von supabase-js eingelöst
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  if (state.session) await loadMe().catch((e) => console.error(e));

  sb.auth.onAuthStateChange((event, session) => {
    // P12 Entscheid 13: Abmelden (alle Wege inkl. Sitzungsablauf, zweiter Tab, Konto löschen) und Kontowechsel
    // leeren alles Gemerkte sofort — vor loadMe() und vor jedem Zeichnen des neuen Kontos.
    if (event === 'SIGNED_OUT' || (session && session.user.id !== state.session?.user?.id)) clearCaches();
    // Supabase empfiehlt: im Callback nichts awaiten, sonst blockiert der Client
    setTimeout(async () => {
      const was = state.session?.user?.id;
      // Direkter Kontowechsel (ohne Abmelden, z. B. zweiter Tab): Inhalt des alten Kontos sofort weg
      if (was && session && session.user.id !== was) $('#view')?.replaceChildren();
      state.session = session;
      if (event === 'PASSWORD_RECOVERY') { go('/passwort-neu'); return; }
      if (event === 'SIGNED_OUT') { state.profile = null; state.memberships = []; state.groupId = null; go('/login', { replace: true }); return; }
      if (session && session.user.id !== was) {
        await loadMe().catch((e) => console.error(e));
        const code = pendingCode.get();
        go(code ? `/code/${encodeURIComponent(code)}` : '/start', { replace: true });
      }
    }, 0);
  });

  // Query-Parameter vom Mail-Link aufräumen (der #-Teil bleibt)
  if (location.search) history.replaceState(null, '', location.pathname + (cameFromReset && state.session ? '#/passwort-neu' : location.hash));

  window.addEventListener('hashchange', render);
  // iOS: Zwei-Finger-Zoom abfangen (Safari ignoriert user-scalable=no; die App soll sich nicht zoomen lassen)
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  render();
}

boot();

// Service Worker (P11 Tempo, src/lib/sw-update.js): registrieren (https; lokal nur mit localStorage['ttg.sw'] = 'on'),
// neue Version nur zwischen ruhigen Routen übernehmen. Steht nach boot(): render() läuft erst nach dessen erstem await.
const swNext = setupSwUpdate({
  container: navigator.serviceWorker, location, document,
  storage: () => sessionStorage, flag: () => localStorage.getItem('ttg.sw'),
});
