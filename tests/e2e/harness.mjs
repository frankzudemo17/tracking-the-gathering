// E2E-Harness (Spec P6, umgestellt in P9b H): Browser, Kontexte, Anmeldung mit den FESTEN Testkonten
// A, B, C (Zugangsdaten nur aus Umgebung/lokaler Datei, nie im Repo), Prüfzähler. Ziel laut E1 = A (WELLE.md):
// die Prod-Supabase aus src/config.js, ausschließlich in der festen Gruppe TTG-E2E-Fixture.
// Grundzustand, Wächter und Aufbau je Testdatei: fixture-api.mjs (run.mjs ruft baseState vor jeder Datei).
// Der Lauf löscht nie ein Konto und nie eine Gruppe — einzige Ausnahme: das Wegwerf-Konto des Opt-ins
// TTG_E2E_SIGNUP=1 (zugang.e2e.mjs, Spec H) löscht sich selbst über die App. Adressen erscheinen nie in Ausgaben
// oder Bildschirmfotos.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Abort, checkGuard } from './fixture-core.mjs';
import {
  ROOT, TARGET, email, password, baseState as baseStateRest, fixtureIds, signIn, rpc, get, api, rest, ensureMember,
} from './fixture-api.mjs';

export { Abort, ROOT, TARGET };
export {
  prepare, ensureMember, ensurePlaceholder, ensureDeck, zugangLive, inviteCode, fixtureIds, NAMES, FIXTURE_NAME,
  snapshot, rpc, get, signIn, api, rest, tally,
} from './fixture-api.mjs';

// ---------------------------------------------------------------- P10 Mitglieder: Probe + Grundzustand über RPC
let mLive = null;
/** Gibt es member_removal_check in der Ziel-Datenbank (P10-Migration in Prod)? Einmal je Lauf, als Konto A. */
export async function mitgliederLive() {
  if (mLive !== null) return mLive;
  try {
    await rpc('a', 'member_removal_check', { p_member: '00000000-0000-4000-8000-000000000000' });
    mLive = true; // unbekannte ID gibt es nicht; ein Erfolg hieße trotzdem: Funktion da
  } catch (e) {
    if (e instanceof Abort) throw e;
    if (e.code === 'PGRST202') mLive = false;
    else if (/not_group_admin/.test(e.message)) mLive = true;
    else throw new Abort('Mitglieder-Probe', `member_removal_check antwortet unerwartet: ${e.message}`);
  }
  return mLive;
}

/**
 * Block K6 schließt direktes delete auf members (Policy mem_delete weg). Nach dem db push nimmt der Grundzustand
 * Platzhalter und B/C deshalb über remove_member (Spiele vorher weg ⇒ Modus delete ⇒ Zeile wirklich weg).
 * Frühere Zeilen von B/C (former_profile_id) kommen über join_playgroup zurück und werden dann entfernt;
 * markierte Platzhalter werden wiederhergestellt und dann gelöscht. Danach läuft der bisherige Grundzustand
 * (fixture-api.mjs, unverändert) und findet keine Zeile mehr, die er per REST löschen müsste.
 */
async function membersViaRpc(log) {
  const fx = fixtureIds();
  if (!fx) throw new Abort('Fixture', 'tests/e2e/fixture-ids.json fehlt — node tests/e2e/fixture.mjs --pruefen');
  const me = await signIn('a');
  if (me.uid !== fx.a) throw new Abort('Wächter', 'Konto A passt nicht zu fixture-ids.json — nichts gelöscht');
  const read = async () => {
    const groups = await get('a', `playgroups?select=id,name,created_by&id=eq.${fx.group}`);
    const members = await get('a', `members?select=*&playgroup_id=eq.${fx.group}`);
    checkGuard({ fixture: fx, group: groups[0] ?? null, members });
    return members;
  };
  let ms = await read();
  const n = { games: 0, rejoined: 0, restored: 0, deleted: 0, marked: 0, files: 0 };
  // Spiele zuerst (Kaskade): danach verweist nichts mehr auf die Zeilen
  n.games = (await api('DELETE', rest(`games?playgroup_id=eq.${fx.group}`), { token: me.token, prefer: 'return=representation' })).length;
  for (const m of ms.filter((x) => x.former_profile_id)) {
    const k = m.former_profile_id === fx.b ? 'b' : m.former_profile_id === fx.c ? 'c' : null;
    if (k) { await ensureMember(k); n.rejoined++; }
  }
  for (const m of ms.filter((x) => x.removed_at && !x.former_profile_id)) { await rpc('a', 'restore_member', { p_member: m.id }); n.restored++; }
  if (n.rejoined || n.restored) ms = await read();
  for (const m of ms.filter((x) => x.profile_id !== fx.a && !x.removed_at)) {
    if (m.role === 'admin') await rpc('a', 'set_member_role', { p_member: m.id, p_role: 'member' });
    const c = await rpc('a', 'member_removal_check', { p_member: m.id });
    if (c.mode === 'already') continue;
    if (c.files?.length) {
      const rm = await api('DELETE', `${TARGET.url}/storage/v1/object/avatars`, { token: me.token, body: { prefixes: c.files } });
      n.files += Array.isArray(rm) ? rm.length : 0;
    }
    const r = await rpc('a', 'remove_member', { p_member: m.id, p_expect: c.mode });
    if (r?.result === 'deleted') n.deleted++; else if (r?.result === 'marked') n.marked++;
  }
  log(`Grundzustand P10 (RPC): ${n.games} Spiele, ${n.rejoined} frühere Zeile(n) zurückgeholt, ${n.restored} wiederhergestellt, ${n.deleted} Zeile(n) entfernt (gelöscht), ${n.marked} markiert, ${n.files} Bild(er)`);
}

/** Grundzustand: nach dem db push zuerst über RPC (K6), dann wie bisher (fixture-api.mjs). */
export async function baseState(opts = {}) {
  if (await mitgliederLive()) await membersViaRpc(opts.log || (() => {}));
  return baseStateRest(opts);
}
export const OUT = path.join(ROOT, 'tests', 'e2e', 'out');

// ---------------------------------------------------------------- Lauf, Prüfzähler
export const RUN = Date.now().toString(36) + randomBytes(3).toString('hex');
export const counts = { pass: 0, fail: 0, skip: 0 };
export const skipped = [];
export const ok = (n, c, info = '') => {
  if (c) { counts.pass++; console.log('  ✓', n); } else { counts.fail++; console.log('  ✗', n, info); }
};
/** Sichtbar übersprungener Fall (zählt weder grün noch rot, steht mit Grund im Protokoll). */
export const skip = (n, reason) => { counts.skip++; skipped.push(`${n} — ${reason}`); console.log('  –', n, `(übersprungen: ${reason})`); };

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
  p.transit = []; // 404 der zwei Übergangsstellen (src/zugang/invite.js) vor dem db push — gewollt, kein Fehler
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errs.push('console: ' + m.text()); });
  p.on('response', (r) => {
    const u = r.url();
    if (r.status() === 404 && u.startsWith(TARGET.url + '/rest/v1/') && /\/rest\/v1\/(rpc\/check_invite|playgroup_invites)(\?|$)/.test(u)) { p.transit.push(u.split('?')[0]); return; }
    if (r.status() === 429 && u.startsWith(TARGET.url + '/auth/')) env.rateLimited = true;
    if (/api\.scryfall\.com/.test(u) && (r.status() === 429 || r.status() >= 500)) env.scryfallDown = true;
    if (r.status() >= 400) p.bad.push(r.status() + ' ' + u.split('?')[0] + (u.includes('grant_type=password') ? '?grant_type=password' : ''));
  });
  // ERR_ABORTED = Suche beim Weitertippen/Seitenwechsel abgebrochen, kein Ausfall
  p.on('requestfailed', (r) => { if (/api\.scryfall\.com/.test(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) env.scryfallDown = true; });
  p.shot = (n) => shot(p, `${name}-${n}`);
  opened.push([name, p]);
  return p;
}

/** Felder und Zeilen, die eine Konto-Adresse zeigen können — in jedem Bildschirmfoto abgedeckt. */
// p.muted.small mit „@“ = „Angemeldet als …“ in Einstellungen → Konto (Fehlerfoto beim Wegwerf-Konto, Spec H)
export const MASK = ['#li-mail', '#rg-mail', 'input[type=email]', '[data-nav="account"] .sub', '[data-confirm]', '.sheet input[type=email]', 'p.muted.small:has-text("@")'];
export const shot = (p, n, opts = {}) => { fs.mkdirSync(OUT, { recursive: true }); return p.screenshot({ path: path.join(OUT, `${n}.png`), mask: MASK.map((m) => p.locator(m)), ...opts }); };
export const hash = (p) => new URL(p.url()).hash;
export const waitHash = (p, h) => p.waitForFunction((x) => location.hash.startsWith(x), h, { timeout: 15000 });

/** Seit P9b gibt es keine Konten je Lauf mehr (Registrierung nur mit Einladungscode). */
export function register() {
  throw new Error("register() gibt es nicht mehr (P9b): feste Testkonten — login(page, 'a'|'b'|'c') und für „A und B in einer Gruppe“ prepare({ members: ['b'] }) bzw. ensureMember('b')");
}

/** Anmelden über die UI als festes Testkonto k ('a'|'b'|'c'). Die Adresse wird nie ausgegeben. */
export async function login(p, k) {
  if (!['a', 'b', 'c'].includes(k)) throw new Error("login(page, k): k ist 'a', 'b' oder 'c' (feste Testkonten)");
  await p.waitForSelector('#li-mail');
  await p.fill('#li-mail', email(k));
  await p.fill('#li-pass', password());
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
