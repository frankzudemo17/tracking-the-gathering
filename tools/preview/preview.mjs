// Vorschau-Werkzeug Etappe 4/5 (Naht P13): echte App lokal im Browser, Daten aus tests/fixtures/gruppe.mjs.
// Kein Konto, keine DB. Statistikdaten kommen über ein Ersatzmodul für src/lib/data.js (groupData);
// übrige Supabase-REST-Aufrufe (Profil, Mitgliedschaften, Mitglieder, Decks) beantwortet es aus der Fixture
// in DB-Spaltenform, RPCs ⇒ 200 {}, Storage-Signaturen ⇒ Platzhalterbild. Sitzung vorgespielt (Franco, Gruppe aktiv).
// Netz: Scryfall-Bilder (Ausfall ⇒ graue Fläche, kein Fehler) und supabase-js von esm.sh (Modul-Import der App).
//
// CLI:
//   node tools/preview/preview.mjs --routes "#/start,#/historie" --looks nacht,arktis,lachs --out <ordner>
//     [--root <worktree>] [--leer] [--init <datei.js>]     ⇒ <out>/<route-slug>-<look>.png (375 × 812, DPR 2, ganze Seite)
//   node tools/preview/preview.mjs --selbsttest             ⇒ prüft das Ersatzmodul im Browser, Exit 0/1
// Exit 1 bei Seitenfehlern (pageerror, Konsole „error“ der App).
//
// Programmier-Schnittstelle (für Beleg-Skripte der UI-Pakete, außerhalb des Repos):
//   import { openPage } from '<worktree>/tools/preview/preview.mjs';
//   const { page, errors, close } = await openPage({ root, look: 'lachs', route: '#/historie', empty: false, init: null });
//   … klicken, page.screenshot(…) … ; await close();
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
const ORIGIN = 'http://ttg.local';
export const VIEWPORT = { width: 375, height: 812 };
export const LOOKS = ['nacht', 'arktis', 'lachs'];
const MIME = {
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', html: 'text/html', json: 'application/json',
  webmanifest: 'application/manifest+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  woff2: 'font/woff2', woff: 'font/woff', ico: 'image/x-icon',
};
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#8A94A3"/></svg>';

/** Fixture laden (frisch je Aufruf; Datei aus dem gewählten Worktree). */
async function fixture(root) {
  return import(pathToFileURL(path.join(root, 'tests', 'fixtures', 'gruppe.mjs')).href);
}

/** Ersatzmodul für src/lib/data.js: groupData direkt aus der Fixture (Vertrag Anhang A). */
function dataModule(empty) {
  return `// Ersatz für src/lib/data.js (tools/preview/preview.mjs) — Daten aus tests/fixtures/gruppe.mjs
import { fixtureGroupData, fixtureDamage } from '../../tests/fixtures/gruppe.mjs';
import { emptyGroupData } from './history-data.js';
const EMPTY = ${empty ? 'true' : 'false'};
export const groupData = {
  async loadGroup(groupId) { return EMPTY ? emptyGroupData(groupId) : fixtureGroupData(); },
  async loadGame(gameId) {
    if (EMPTY) return null;
    const d = fixtureGroupData();
    const game = d.games.find((g) => g.id === gameId);
    if (!game) return null;
    const mine = (rows) => rows.filter((r) => r.gameId === gameId);
    const players = mine(d.players);
    const inGame = new Set(players.map((p) => p.memberId));
    const decks = new Set(players.map((p) => p.deckId));
    return {
      groupId: d.groupId, game, damage: fixtureDamage(gameId),
      members: d.members.filter((m) => inGame.has(m.id)), decks: d.decks.filter((x) => decks.has(x.id)),
      sessions: d.sessions.filter((s) => s.id === game.sessionId), games: [game], players,
      ratings: mine(d.ratings), deckSalt: mine(d.deckSalt), potg: mine(d.potg), turns: mine(d.turns),
    };
  },
  invalidate() {},
};
`;
}

/** DB-Zeilen (Spaltenform wie Supabase) aus der Fixture für die bestehenden Seiten. */
function dbTables(fx, look) {
  const d = fx.fixtureGroupData();
  const at = '2026-10-01T19:00:00Z';
  const names = Object.fromEntries(d.members.filter((m) => m.profileId).map((m) => [m.profileId, m.name]));
  const profiles = Object.entries(names).map(([id, name]) => ({
    id, display_name: name, locale: 'de', theme: id === fx.ME_PROFILE ? look : 'nacht', avatar_path: null, created_at: at,
  }));
  const playgroup = { id: fx.GROUP_ID, name: '727', invite_code: 'TTG-VORSCHAU', created_by: fx.ME_PROFILE, created_at: at };
  const members = d.members.map((m, i) => ({
    id: m.id, playgroup_id: fx.GROUP_ID, profile_id: m.profileId, display_name: m.name,
    role: m.id === fx.ME_MEMBER ? 'admin' : 'member', claim_code: m.isPlaceholder ? 'TIM-4K9QXZ' : null,
    created_at: `2026-10-01T19:0${i}:00Z`, avatar_path: m.avatarPath,
    profiles: m.profileId ? { display_name: m.name, avatar_path: m.avatarPath } : null,
    playgroups: playgroup,
  }));
  const decks = d.decks.map((x) => ({
    id: x.id, owner_profile_id: x.ownerProfileId, owner_member_id: x.ownerMemberId, commander_name: x.commanderName,
    partner_name: x.partnerName, short_name: x.shortName, color_identity: x.colors, image_url: x.imageUrl,
    partner_image_url: null, bracket: x.bracket, list_url: null, archived: x.archived, field_color: null, counter_pins: null, created_at: at,
  }));
  return { profiles, members, decks, playgroups: [playgroup] };
}

/** Mini-PostgREST: Filter eq./in./is. auf eine Zeilenliste anwenden (select/order/limit/or werden ignoriert). */
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns'].includes(k)) continue;
    const m = v.match(/^(eq|neq|in|is)\.(.*)$/);
    if (!m) continue;
    const [, op, val] = m;
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => String(r[k]) !== val);
    else if (op === 'is') out = out.filter((r) => (val === 'null' ? r[k] == null : String(r[k]) === val));
    else if (op === 'in') {
      const set = new Set(val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')));
      out = out.filter((r) => set.has(String(r[k])));
    }
  }
  return out;
}

/**
 * Eine Seite der echten App mit Fixture-Daten öffnen.
 * @param {{ root?: string, look?: string, route?: string, empty?: boolean, init?: string|null, browser?: any }} opts
 *   init: JS-Quelltext, läuft vor jedem Skript der Seite (z. B. window.__ttgNow = …; sessionStorage …).
 * @returns {Promise<{ page: any, errors: string[], close: () => Promise<void> }>}
 */
export async function openPage({ root: rootIn = DEFAULT_ROOT, look = 'nacht', route = '#/start', empty = false, init = null, browser = null } = {}) {
  const { chromium } = await import('playwright');
  const root = path.resolve(rootIn);
  const ownBrowser = !browser;
  const b = browser || await chromium.launch(process.env.TTG_CHROMIUM ? { executablePath: process.env.TTG_CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'de-DE' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location()?.url || '';
    // Bilder fremder Hosts (Scryfall) dürfen ausfallen: graue Fläche, kein Fehler
    if (/Failed to load resource/i.test(msg.text()) && url && !url.startsWith(ORIGIN)) return;
    errors.push(`console: ${msg.text()}${url ? ` (${url})` : ''}`);
  });

  const fx = await fixture(root);
  const db = dbTables(fx, look);

  // 1) Dateien der App aus dem Worktree
  await page.route(`${ORIGIN}/**`, async (r) => {
    let p = decodeURIComponent(new URL(r.request().url()).pathname.slice(1)) || 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return r.fulfill({ status: 404, body: 'nicht gefunden' });
    await r.fulfill({ status: 200, body: fs.readFileSync(file), contentType: MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream' });
  });
  // 2) Ersatzmodul für src/lib/data.js (später registriert ⇒ hat Vorrang vor 1)
  await page.route(`${ORIGIN}/src/lib/data.js`, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: dataModule(empty) }));
  // 3) Supabase (REST, RPC, Storage, Auth) vorgespielt
  await page.route('**/*.supabase.co/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.startsWith('/storage/v1/object/sign/') && req.method() === 'POST') {
      let paths = [];
      try { paths = JSON.parse(req.postData() || '{}').paths || []; } catch { /* leer */ }
      return json(paths.map((p) => ({ path: p, signedURL: `/object/sign/vorschau/${encodeURIComponent(p)}?token=vorschau`, error: null })));
    }
    if (u.pathname.startsWith('/storage/')) return r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: PLACEHOLDER });
    if (u.pathname.startsWith('/auth/')) return json({ id: fx.ME_PROFILE, aud: 'authenticated', email: 'vorschau@example.com', user_metadata: {} });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json({});
    if (u.pathname.startsWith('/rest/v1/')) {
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return json([]);
      const table = u.pathname.slice('/rest/v1/'.length);
      const rows = applyFilters(db[table] || [], [...u.searchParams]);
      const single = (req.headers().accept || '').includes('vnd.pgrst.object');
      return json(single ? rows[0] ?? null : rows);
    }
    return json({});
  });
  // 4) Sitzung, Look, Gruppe vor dem ersten Skript
  await page.addInitScript(([uid, gid, theme]) => {
    const sess = {
      access_token: 'vorschau', refresh_token: 'vorschau', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 7 * 86400,
      user: { id: uid, aud: 'authenticated', email: 'vorschau@example.com', user_metadata: {} },
    };
    try {
      localStorage.setItem('ttg-auth', JSON.stringify(sess));
      localStorage.setItem('ttg.theme', theme);
      localStorage.setItem('ttg.group', gid);
      localStorage.setItem('ttg.lang', 'de');
    } catch { /* egal */ }
  }, [fx.ME_PROFILE, fx.GROUP_ID, look]);
  if (init) await page.addInitScript({ content: init });

  await page.goto(`${ORIGIN}/index.html${route.startsWith('#') ? route : '#' + route}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const close = async () => { await ctx.close(); if (ownBrowser) await b.close(); };
  return { page, errors, close };
}

/** Warten, bis der View gezeichnet ist (kein Lade-Spinner mehr) und Bilder geladen sind (mit Zeitgrenzen). */
export async function settle(page, ms = 12000) {
  await page.waitForFunction(() => {
    const v = document.querySelector('#view');
    return !!v && !v.querySelector(':scope > .loading') && !document.querySelector('#app > .loading');
  }, null, { timeout: ms }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(250);
}

const slug = (route) => route.replace(/^#?\/?/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'start';

/** Selbsttest: Ersatzmodul im Browser (normal + leer). */
async function selfTest(root) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch(process.env.TTG_CHROMIUM ? { executablePath: process.env.TTG_CHROMIUM } : {});
  const checks = [];
  const ok = (name, cond, info = '') => { checks.push(cond); console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ` ${info}`}`); };
  try {
    const fx = await fixture(root);
    const full = await openPage({ root, route: '#/start', browser: b });
    const r = await full.page.evaluate(async (gid) => {
      const { groupData } = await import('/src/lib/data.js');
      const g = await groupData.loadGroup(gid);
      const one = await groupData.loadGame('g1');
      const none = await groupData.loadGame('x');
      return { games: g.games.length, players: g.players.length, onePlayers: one?.players.length, oneDamage: one?.damage.length, oneGame: one?.game?.id, none };
    }, fx.GROUP_ID);
    ok('loadGroup ⇒ 6 Spiele', r.games === 6, JSON.stringify(r));
    ok('loadGroup ⇒ 25 Spielerzeilen', r.players === 25, JSON.stringify(r));
    ok("loadGame('g1') ⇒ 4 Spieler + 5 Schadenszeilen", r.onePlayers === 4 && r.oneDamage === 5 && r.oneGame === 'g1', JSON.stringify(r));
    ok("loadGame('x') ⇒ null", r.none === null, JSON.stringify(r));
    ok('Startseite ohne Seitenfehler', full.errors.length === 0, full.errors.join(' | '));
    ok('Startseite gezeichnet (Navigation da)', await full.page.locator('nav.nav').count() === 1);
    await full.close();
    const leer = await openPage({ root, route: '#/start', empty: true, browser: b });
    const e = await leer.page.evaluate(async (gid) => {
      const { groupData } = await import('/src/lib/data.js');
      const g = await groupData.loadGroup(gid);
      return { games: g.games.length, groupId: g.groupId, game: await groupData.loadGame('g1') };
    }, fx.GROUP_ID);
    ok('--leer ⇒ 0 Spiele', e.games === 0 && e.groupId === fx.GROUP_ID, JSON.stringify(e));
    ok("--leer ⇒ loadGame('g1') null", e.game === null, JSON.stringify(e));
    await leer.close();
  } finally { await b.close(); }
  const pass = checks.filter(Boolean).length;
  console.log(`selbsttest: ${pass}/${checks.length} ok`);
  return pass === checks.length;
}

function parseArgs(argv) {
  const a = { root: DEFAULT_ROOT, routes: ['#/start'], looks: [...LOOKS], out: null, empty: false, init: null, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v == null) throw new Error(`${k} braucht einen Wert`); return v; };
    if (k === '--root') a.root = path.resolve(next());
    else if (k === '--routes') a.routes = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--looks') a.looks = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--out') a.out = path.resolve(next());
    else if (k === '--leer') a.empty = true;
    else if (k === '--init') a.init = fs.readFileSync(path.resolve(next()), 'utf8');
    else if (k === '--selbsttest') a.selftest = true;
    else throw new Error(`unbekannte Option ${k}`);
  }
  for (const l of a.looks) if (!LOOKS.includes(l)) throw new Error(`Look ${l} gibt es nicht (${LOOKS.join(', ')})`);
  // Git-Bash schreibt Argumente wie „/start“ zu Windows-Pfaden um ⇒ MSYS_NO_PATHCONV=1 setzen
  for (const r of a.routes) if (!/^#?\//.test(r)) throw new Error(`Route „${r}“ beginnt nicht mit #/ (Git-Bash? MSYS_NO_PATHCONV=1 setzen)`);
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.selftest) process.exit((await selfTest(a.root)) ? 0 : 1);
  if (!a.out) throw new Error('--out <ordner> fehlt');
  fs.mkdirSync(a.out, { recursive: true });
  const { chromium } = await import('playwright');
  const b = await chromium.launch(process.env.TTG_CHROMIUM ? { executablePath: process.env.TTG_CHROMIUM } : {});
  let bad = 0;
  try {
    for (const route of a.routes) {
      for (const look of a.looks) {
        const { page, errors, close } = await openPage({ root: a.root, look, route, empty: a.empty, init: a.init, browser: b });
        const file = path.join(a.out, `${slug(route)}-${look}.png`);
        await page.screenshot({ path: file, fullPage: true });
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        console.log(`${errors.length ? '✗' : '✓'} ${file}${wide ? ' · WARNUNG horizontale Scrollleiste' : ''}`);
        for (const e of errors) console.log(`    ${e}`);
        bad += errors.length;
        await close();
      }
    }
  } finally { await b.close(); }
  console.log(`vorschau: ${a.routes.length * a.looks.length} Bilder, ${bad} Seitenfehler`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`vorschau: ${e.message}`); process.exit(1); });
}
