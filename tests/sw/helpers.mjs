// Helfer der Service-Worker-Messungen (Spec P11 Tempo, Kriterien 19–27): Wegwerf-Stände der App im
// Temp-Ordner des Systems, lokaler Server mit Anfrage-Protokoll, Chromium mit dauerhaftem Profil.
// Spricht nie mit Prod: es gibt keine Anmeldung, keine Konten; Anfragen an *.supabase.co werden gezählt
// (Kriterium 27 verlangt 0). tests/e2e/harness.mjs ist bewusst NICHT eingebunden (der spricht mit Prod).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/serve.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OFFLINE_RULE = '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost';
const SHIPPED = ['index.html', 'manifest.webmanifest', 'sw.js', 'src', 'assets'];

/** Abbruch aus Umgebungsgründen (Messgerät untauglich, Browser fehlt) ⇒ Exit 2, nie „grün“. */
export class Abort extends Error {}

// ---------------------------------------------------------------- Temp-Ordner, Stände
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-sw-'));
export function cleanup() {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
let seq = 0;
export const tmpDir = (name) => { const d = path.join(TMP, `${name}-${++seq}`); fs.mkdirSync(d, { recursive: true }); return d; };

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const edit = (file, fn) => {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`Stand: Änderung an ${path.basename(file)} griff nicht`);
  fs.writeFileSync(file, after);
};

/** Abzug des Start-main (Stand O) per git archive; Standard: merge-base HEAD main. */
export function archiveStartMain(ref = process.env.TTG_SW_BASE || execFileSync('git', ['-C', ROOT, 'merge-base', 'HEAD', 'main'], { encoding: 'utf8' }).trim()) {
  const dir = tmpDir('archiv');
  const tar = path.join(dir, 'archiv.tar');
  execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tar, ref, ...SHIPPED]);
  // relativer Pfad mit cwd: GNU tar hielte „C:“ sonst für einen entfernten Rechner
  execFileSync('tar', ['-xf', 'archiv.tar'], { cwd: dir });
  fs.rmSync(tar, { force: true });
  return { dir, ref };
}

/**
 * Wegwerf-Kopie der App. version: 'ttg-vNNN' (sw.js VERSION + passende src/version.js);
 * stamp: jede src/**\/*.js endet auf eine Zeile, die den Stempel in globalThis.__ttgStamps legt;
 * edits: { 'pfad': (text) => text } nach dem Stempeln.
 */
export function makeStand(name, { from = ROOT, version, stamp = name, edits = {}, remove = [] } = {}) {
  const dir = tmpDir(`stand-${name}`);
  for (const p of SHIPPED) fs.cpSync(path.join(from, p), path.join(dir, p), { recursive: true });
  const current = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)';/)?.[1];
  if (version && version !== current) {
    edit(path.join(dir, 'sw.js'), (t) => t.replace(/const VERSION = 'ttg-v\d+';/, `const VERSION = '${version}';`));
    edit(path.join(dir, 'src', 'version.js'), (t) => t.replace(/APP_VERSION = 'v\d+'/, `APP_VERSION = '${version.replace(/^ttg-/, '')}'`));
  }
  for (const f of walk(path.join(dir, 'src')).filter((f) => f.endsWith('.js'))) {
    fs.appendFileSync(f, `\n;(globalThis.__ttgStamps ??= new Set()).add(${JSON.stringify(stamp)});\n`);
  }
  for (const [p, fn] of Object.entries(edits)) edit(path.join(dir, p), fn);
  for (const p of remove) fs.rmSync(path.join(dir, p));
  return { name, dir, version, stamp };
}

// ---------------------------------------------------------------- Server mit Protokoll
/** Server über einem Stand; log = Pfade (ohne Query), die den Server erreichen. Gleicher Port bei restart(). */
export async function server(stand, { cacheControl } = {}) {
  const s = { log: [], fault: null, cacheControl, stand };
  const opts = () => ({
    root: s.stand.dir, port: s.port ?? 0, cacheControl: s.cacheControl,
    onRequest: ({ path: p }) => s.log.push(p),
    intercept: (req, res, p) => s.fault?.(req, res, p) ?? false,
  });
  s.http = await serve(opts());
  s.port = s.http.port;
  s.url = s.http.url;
  s.use = (st) => { s.stand = st; s.http.setRoot(st.dir); };
  s.clear = () => { s.log.length = 0; };
  s.close = async () => { if (s.http) { await s.http.close(); s.http = null; } };
  s.restart = async () => { await s.close(); s.http = await serve(opts()); };
  return s;
}

// ---------------------------------------------------------------- Browser
export const prod = { requests: 0, hosts: new Set() };
/** Alle Hosts, die der Kontext-Zähler gesehen hat — für die Positivkontrolle des K27-Zählers in S1b. */
export const seenHosts = new Set();
let chromium;
async function pw() {
  if (chromium) return chromium;
  try { ({ chromium } = await import('playwright')); } catch { throw new Abort('Playwright fehlt (npm ci)'); }
  return chromium;
}

/** Chromium mit dauerhaftem Profil (Service Worker und Caches überleben den Neustart). */
export async function browser(profile, { offline = false, rule = true, sw = true } = {}) {
  const c = await pw();
  let ctx;
  try {
    ctx = await c.launchPersistentContext(profile, {
      headless: true, viewport: { width: 390, height: 844 }, locale: 'de-DE',
      // ServiceWorkerAutoPreload aus: sonst schickt Chromium bei kalt gestartetem Worker die Navigation zusätzlich
      // parallel ins Netz und verwirft die Antwort (die Seite kommt trotzdem aus cache-storage). TTG_AUTOPRELOAD=1 schaltet sie an.
      args: [...(process.env.TTG_AUTOPRELOAD ? [] : ['--disable-features=ServiceWorkerAutoPreload']), ...(offline && rule ? [OFFLINE_RULE] : [])],
      ...(process.env.TTG_CHROMIUM ? { executablePath: process.env.TTG_CHROMIUM } : {}),
    });
  } catch (e) {
    if (/Executable doesn't exist|ENOENT/i.test(e.message)) throw new Abort('Chromium fehlt — npx playwright install chromium');
    throw e;
  }
  if (sw) await ctx.addInitScript(() => { try { localStorage.setItem('ttg.sw', 'on'); } catch { /* egal */ } });
  await ctx.addInitScript(() => {
    window.__cc = 0;
    navigator.serviceWorker?.addEventListener('controllerchange', () => { window.__cc++; });
  });
  ctx.on('request', (r) => {
    let h = '';
    try { h = new URL(r.url()).hostname; } catch { return; }
    seenHosts.add(h);
    if (h === 'supabase.co' || h.endsWith('.supabase.co')) { prod.requests++; prod.hosts.add(h); }
  });
  return ctx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/** Bis fn() wahr ist, höchstens ms. */
export async function until(fn, ms = 20000, step = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => false);
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}

/** Was sichtbar sein muss, damit eine Seite „gezeichnet“ ist. */
export const READY = {
  '#/login': '#view form.auth-card',
  '#/registrieren': '#view form.auth-card',
  '#/passwort-vergessen': '#view form',
  '#/datenschutz': '#view #ctl-h', // Datenschutz zeigt kein data-version (das steht nur auf #/einstellungen/rechtliches)
  '#/einstellungen/rechtliches': '#view [data-version]',
};

/** Seite mit Zählern: loads (Hauptrahmen), errors (pageerror), consoleErrors ({ text, url }). */
function watch(p) {
  p.loads = 0;
  p.errors = [];
  p.consoleErrors = [];
  p.on('load', () => { p.loads++; });
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.consoleErrors.push({ text: m.text(), url: m.location()?.url ?? '' }); });
  return p;
}

/** Ein „Start“: alle Seiten schließen (kein Fenster mehr offen), neue Seite, Ziel zeichnen lassen. */
export async function start(ctx, url, hash = '#/login', { ready = true, closeOthers = true } = {}) {
  if (closeOthers) for (const p of ctx.pages()) await p.close();
  const p = watch(await ctx.newPage());
  const t0 = Date.now();
  await p.goto(url + hash, { waitUntil: 'load', timeout: 30000 });
  if (ready) await p.waitForSelector(READY[hash], { timeout: 20000 });
  p.readyMs = Date.now() - t0;
  return p;
}

/** Zustand aus Sicht der Seite. */
export function state(p) {
  return p.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return {
      controller: !!navigator.serviceWorker.controller,
      active: r?.active?.state ?? null, waiting: !!r?.waiting, installing: !!r?.installing,
      keys: (await caches.keys()).sort(),
      stamps: [...(globalThis.__ttgStamps ?? [])].sort(),
      cc: window.__cc ?? 0,
      hash: location.hash,
      version: document.querySelector('[data-version]')?.textContent ?? null,
      errorView: !!document.querySelector('#view [data-reload]'),
    };
  });
}

/** Update-Suche wie die Seite sie auslöst (registration.update()), dann warten bis nichts mehr installiert. */
export async function updateAndSettle(p, ms = 30000) {
  await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update().catch(() => {}); });
  await until(async () => { const s = await state(p); return !s.installing; }, ms);
  return state(p);
}

/** Routenwechsel per Hash; wartet bis gezeichnet (auch nach einem Neuladen) und lässt dann ms Ruhe. */
export async function navigate(p, hash, { settle = 1500 } = {}) {
  await p.evaluate((h) => { location.hash = h; }, hash);
  await until(() => p.evaluate((sel) => !!document.querySelector(sel), READY[hash]), 15000);
  await sleep(settle);
  await p.waitForSelector(READY[hash], { timeout: 15000 });
}
