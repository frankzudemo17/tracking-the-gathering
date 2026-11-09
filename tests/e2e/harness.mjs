// E2E-Harness (Spec P6): Browser, Kontexte, Konten, Prüfzähler und Aufräumen der Testdaten.
// Ziel laut E1 = A (WELLE.md): die Prod-Supabase aus src/config.js. Testkonten heißen
// ttg.test.<n>.<RUN>@gmail.com und bleiben nach dem Lauf bestehen (Löschen nur nach Francos Ja,
// Befehl druckt run.mjs). Aufgeräumt werden die DATEN des Laufs, und zwar nur als das jeweilige
// Testkonto über die öffentliche REST-API (anon key + Login, RLS greift): eigene Testgruppen
// (erst deren Spiele, dann die Gruppe — siehe tests/db/aufraeumen.test.mjs), eigene Decks,
// eigene Profilbilder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = path.join(ROOT, 'tests', 'e2e', 'out');
export const PW = 'Testpasswort-123';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import(pathToFileURL(path.join(ROOT, 'src', 'config.js')).href);
export const TARGET = { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };

/** Abbruch aus Umgebungsgründen (Browser fehlt, Rate-Limit, Scryfall …) ⇒ Exit 2, nie „grün“. */
export class Abort extends Error {
  constructor(reason, msg) { super(msg); this.reason = reason; }
}

// ---------------------------------------------------------------- Lauf, Konten, Prüfzähler
export let RUN = Date.now().toString(36);
export const accounts = [];
export const runFile = (run = RUN) => path.join(OUT, `${run}.json`);
const MAIL_RE = /^ttg\.test\.([a-z0-9]+)\.([a-z0-9]+)@gmail\.com$/;
/** Nur Konten genau dieses Laufs (harte Sperre gegen fremde Adressen, auch beim Nur-Aufräumen). */
export const isRunMail = (email, run = RUN) => MAIL_RE.exec(email)?.[2] === run;
export const mail = (n) => `ttg.test.${n}.${RUN}@gmail.com`;

function saveRun() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(runFile(), JSON.stringify({ run: RUN, target: TARGET.url, accounts }, null, 2));
}

export const counts = { pass: 0, fail: 0 };
export const ok = (n, c, info = '') => {
  if (c) { counts.pass++; console.log('  ✓', n); } else { counts.fail++; console.log('  ✗', n, info); }
};

// ---------------------------------------------------------------- Browser und Seiten
export async function launch() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch {
    throw new Abort('Playwright fehlt', 'Paket playwright nicht installiert — npm ci');
  }
  try {
    return await chromium.launch(process.env.TTG_CHROMIUM ? { executablePath: process.env.TTG_CHROMIUM } : {});
  } catch (e) {
    if (/Executable doesn't exist|executable.*not found|ENOENT/i.test(e.message)) {
      throw new Abort('Browser fehlt', `Chromium nicht gefunden${process.env.TTG_CHROMIUM ? ` (TTG_CHROMIUM=${process.env.TTG_CHROMIUM})` : ''} — npx playwright install chromium`);
    }
    throw e;
  }
}

export const env = { rateLimited: false, scryfallDown: false };
/** Alle in diesem Lauf geöffneten Seiten [name, page] (für Fehler-Screenshots). */
export const opened = [];

/** Neuer Kontext 390×844, de-DE; sammelt pageerror, Konsolenfehler, HTTP ≥ 400. */
export async function ctx(browser, name) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'de-DE' });
  const p = await c.newPage();
  p.errs = [];
  p.bad = [];
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errs.push('console: ' + m.text()); });
  p.on('response', (r) => {
    const u = r.url();
    if (r.status() === 429 && u.startsWith(TARGET.url + '/auth/')) env.rateLimited = true;
    if (/api\.scryfall\.com/.test(u) && (r.status() === 429 || r.status() >= 500)) env.scryfallDown = true;
    if (r.status() >= 400) p.bad.push(r.status() + ' ' + u.split('?')[0] + (u.includes('grant_type=password') ? '?grant_type=password' : ''));
  });
  p.on('requestfailed', (r) => { if (/api\.scryfall\.com/.test(r.url())) env.scryfallDown = true; });
  p.shot = (n) => shot(p, `${name}-${n}`);
  opened.push([name, p]);
  return p;
}

export const shot = (p, n) => { fs.mkdirSync(OUT, { recursive: true }); return p.screenshot({ path: path.join(OUT, `${n}.png`) }); };
export const hash = (p) => new URL(p.url()).hash;
export const waitHash = (p, h) => p.waitForFunction((x) => location.hash.startsWith(x), h, { timeout: 15000 });

/** Registriert ein Testkonto über die UI. Das Konto steht VOR dem Absenden in out/<RUN>.json. */
export async function register(p, name, email) {
  if (!isRunMail(email)) throw new Error(`register: ${email} ist kein Testkonto dieses Laufs`);
  if (accounts.length >= 3 && !accounts.includes(email)) throw new Error('register: höchstens 3 Konten je Lauf');
  if (!accounts.includes(email)) { accounts.push(email); saveRun(); }
  await p.click('text=Konto erstellen');
  await waitHash(p, '#/registrieren');
  await p.fill('#rg-name', name);
  await p.fill('#rg-mail', email);
  await p.fill('#rg-pass', PW);
  await p.click('button[type=submit]');
}

/** Anmelden über die UI. */
export async function login(p, email, pw = PW) {
  await p.waitForSelector('#li-mail');
  await p.fill('#li-mail', email);
  await p.fill('#li-pass', pw);
  await p.click('button[type=submit]');
}

/** Testbild (PNG) für Profilbilder — wird beim ersten Aufruf mit dem Browser selbst gerendert. */
export async function testImage(browser) {
  const file = path.join(OUT, 'testbild.png');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(OUT, { recursive: true });
  const c = await browser.newContext({ viewport: { width: 320, height: 240 } });
  const p = await c.newPage();
  await p.setContent('<body style="margin:0;background:linear-gradient(135deg,#24325A,#c96f53)"><div style="font:bold 64px sans-serif;color:#fff;padding:70px 40px">TTG</div></body>');
  await p.screenshot({ path: file });
  await c.close();
  return file;
}

// ---------------------------------------------------------------- Aufräumen (REST als Testkonto)
async function api(method, url, { token, body, prefer } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      apikey: TARGET.key,
      Authorization: `Bearer ${token ?? TARGET.key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(`${method} ${url.replace(TARGET.url, '')} → ${r.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
const rest = (p) => `${TARGET.url}/rest/v1/${p}`;
const inList = (ids) => `in.(${ids.join(',')})`;

/**
 * Räumt die Daten aller Konten des Laufs ab und meldet je Konto, was übrig ist.
 * Liefert { groupsLeft, accounts, problems }. Wirft nie (läuft in finally).
 */
export async function cleanup({ run = RUN, list = accounts } = {}) {
  const problems = [];
  let groupsLeft = 0;
  let deleted = { groups: 0, games: 0, decks: 0, avatars: 0 };
  const done = [];
  for (const email of list) {
    if (!isRunMail(email, run)) { problems.push(`${email}: kein Testkonto des Laufs ${run} — übersprungen`); continue; }
    let auth;
    try {
      auth = await api('POST', `${TARGET.url}/auth/v1/token?grant_type=password`, { body: { email, password: PW } });
    } catch (e) {
      // Konto nie angelegt (Abbruch vor/bei der Registrierung) ⇒ nichts zu räumen
      if (/400/.test(e.message)) { done.push(`${email}: nicht angemeldet (kein Konto?)`); continue; }
      problems.push(`${email}: Anmeldung fehlgeschlagen: ${e.message}`); continue;
    }
    const token = auth.access_token, uid = auth.user?.id;
    try {
      // eigene Testgruppen: angelegt von diesem Konto (RLS lässt nur Admins löschen)
      const groups = await api('GET', rest(`playgroups?select=id&created_by=eq.${uid}`), { token });
      const gids = groups.map((g) => g.id);
      const avatarPaths = [`profiles/${uid}/avatar.jpg`];
      if (gids.length) {
        const mem = await api('GET', rest(`members?select=id&playgroup_id=${inList(gids)}`), { token });
        avatarPaths.push(...mem.map((m) => `members/${m.id}/avatar.jpg`));
        // Reihenfolge: erst Spiele, dann Gruppe (FK game_players → members ohne Kaskade, Befund P6)
        const ga = await api('DELETE', rest(`games?playgroup_id=${inList(gids)}`), { token, prefer: 'return=representation' });
        deleted.games += ga.length;
      }
      try {
        const rm = await api('DELETE', `${TARGET.url}/storage/v1/object/avatars`, { token, body: { prefixes: avatarPaths } });
        deleted.avatars += Array.isArray(rm) ? rm.length : 0;
      } catch (e) { problems.push(`${email}: Profilbilder: ${e.message}`); }
      if (gids.length) {
        const pg = await api('DELETE', rest(`playgroups?id=${inList(gids)}`), { token, prefer: 'return=representation' });
        deleted.groups += pg.length;
      }
      const dk = await api('DELETE', rest(`decks?owner_profile_id=eq.${uid}`), { token, prefer: 'return=representation' });
      deleted.decks += dk.length;
      // Nachweis (Kriterium 3): sichtbare Gruppen dieses Kontos
      const left = await api('GET', rest('playgroups?select=id'), { token });
      groupsLeft += left.length;
      done.push(`${email}: ${left.length} Gruppen sichtbar`);
    } catch (e) {
      problems.push(`${email}: ${e.message}`);
    }
  }
  console.log(`\nAufräumen (Lauf ${run}): ${deleted.groups} Testgruppen, ${deleted.games} Spiele, ${deleted.decks} Konto-Decks, ${deleted.avatars} Profilbilder gelöscht`);
  for (const d of done) console.log('    ' + d);
  for (const pr of problems) console.log('    ! ' + pr);
  console.log(`  ${groupsLeft} Testgruppen übrig${problems.length ? ` · ${problems.length} Problem(e)` : ''}`);
  return { groupsLeft, accounts: list.length, problems };
}

/** Lösch-Befehl für die Testkonten (E1 = A: nur drucken, Franco führt ihn nach Freigabe aus). */
export function deleteHint(run = RUN) {
  return [
    `Testkonten dieses Laufs bleiben bestehen (E1 = A). Löschen nur nach Francos Freigabe,`,
    `im Supabase-Dashboard (SQL-Editor, Projekt ${new URL(TARGET.url).hostname.split('.')[0]}):`,
    `  delete from auth.users where email like 'ttg.test.%.${run}@gmail.com';`,
    `Rest im Storage (per RLS für niemanden löschbar): Profilbild übernommener Platzhalter`,
    `unter avatars/members/<id>/avatar.jpg — bei Bedarf im Dashboard (Storage → avatars) entfernen.`,
  ].join('\n');
}

/** Konten eines früheren (abgebrochenen) Laufs aus out/<RUN>.json. */
export function loadRun(run) {
  if (!/^[a-z0-9]+$/.test(run ?? '')) throw new Abort('Aufruf', `--nur-aufraeumen braucht eine Lauf-Kennung (z. B. ${RUN})`);
  const f = runFile(run);
  if (!fs.existsSync(f)) throw new Abort('Aufruf', `${path.relative(ROOT, f)} fehlt — keine gespeicherten Konten für Lauf ${run}`);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = (data.accounts ?? []).filter((e) => isRunMail(e, run));
  return list;
}

export function setRun(run) { RUN = run; }
