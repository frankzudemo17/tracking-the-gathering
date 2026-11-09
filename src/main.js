// Start, Router, Auth-Status
import { sb, configured } from './supabase.js';
import { state, loadMe, applyPrefs, pendingCode } from './state.js';
import { route, current, go } from './router.js';
import { html, mount, $ } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { loading } from './lib/parts.js';
import { t } from './i18n/index.js';

// ---------- Routen ----------
const v = (name) => () => import(`./views/${name}.js`);
route('/login', v('login'), { public: true });
route('/registrieren', v('register'), { public: true });
route('/passwort-vergessen', v('forgot'), { public: true });
route('/passwort-neu', v('newpass'));
route('/code/:code', v('code'), { public: true });
route('/willkommen', v('welcome'));
route('/start', v('start'), { nav: 'start', group: true });
route('/spielen', v('soon'), { nav: 'play', group: true, arg: 'play' });
route('/historie', v('soon'), { nav: 'history', group: true, arg: 'history' });
route('/rangliste', v('soon'), { nav: 'board', group: true, arg: 'board' });
route('/profil', v('profile'), { nav: 'me', group: true });
route('/profil/:memberId', v('profile'), { nav: 'me', group: true });
route('/gruppen', v('groups'));
route('/spieler-neu', v('add-player'), { group: true });
route('/deck-neu/:memberId', v('add-deck'), { group: true });
route('/deck/:id', v('deck'), { nav: 'me', group: true });

const NAV = [
  ['start', '#/start', 'home'], ['play', '#/spielen', 'play'], ['history', '#/historie', 'history'],
  ['board', '#/rangliste', 'trophy'], ['me', '#/profil', 'user'],
];
// Aktiver Tab zeigt das gefüllte Icon

const app = $('#app');
let renderToken = 0;
// Passwort-Link aus der Mail: ?reset=1&code=… (synchron merken, bevor supabase-js die URL aufräumt)
const cameFromReset = new URLSearchParams(location.search).has('reset');

function navHtml(active) {
  return html`<nav class="nav" aria-label="Hauptnavigation">${NAV.map(([k, href, ic]) =>
    html`<a href="${href}" ${active === k ? html`aria-current="page"` : ''}>${icon(active === k ? ic + 'Fill' : ic, 23)}<span>${t(`nav.${k}`)}</span></a>`)}</nav>`;
}

export async function render() {
  const token = ++renderToken;
  const r = current();
  if (!r) return go('/start', { replace: true });

  // Zugriffsregeln
  if (!state.session && !r.opts.public) return go('/login', { replace: true });
  if (state.session && ['/login', '/registrieren'].includes(r.path)) return go('/start', { replace: true });
  if (state.session && r.opts.group && !state.groupId) return go('/willkommen', { replace: true });

  mount(app, html`<main id="view" class="screen ${r.opts.nav ? 'with-nav' : ''}">${loading()}</main>${r.opts.nav ? navHtml(r.opts.nav) : ''}`);
  try {
    const mod = await r.load();
    if (token !== renderToken) return;
    const view = $('#view');
    await mod.default(view, { params: r.params, arg: r.opts.arg, isStale: () => token !== renderToken });
    if (token === renderToken) { view.focus?.({ preventScroll: true }); window.scrollTo(0, 0); }
  } catch (e) {
    console.error(e);
    if (token === renderToken) mount($('#view'), html`<div class="empty"><b>${t('common.error')}</b><span class="small">${e.message || ''}</span></div>`);
  }
}

// ---------- Start ----------
async function boot() {
  applyPrefs(null);
  if (!configured) { mount(app, html`<main class="screen"><p>Supabase ist noch nicht konfiguriert (src/config.js).</p></main>`); return; }

  // Nach Klick auf einen Passwort-Link: ?code=… wird von supabase-js eingelöst
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  if (state.session) await loadMe().catch((e) => console.error(e));

  sb.auth.onAuthStateChange((event, session) => {
    // Supabase empfiehlt: im Callback nichts awaiten, sonst blockiert der Client
    setTimeout(async () => {
      const was = state.session?.user?.id;
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
  render();
}

boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
}
