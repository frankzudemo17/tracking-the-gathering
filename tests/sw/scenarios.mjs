// Szenarien S1–S8 (Spec P11 Tempo, Kriterien 19–26) und die Zeitmessung T (informativ).
// Jedes Szenario: eigenes Profil, eigener Server (fester Port über Neustarts), eigene Stände im Temp-Ordner.
// Rückgabe: Liste von Prüfungen [{ ok, name, info }] und eine Messzeile.
import fs from 'node:fs';
import path from 'node:path';
import {
  Abort, makeStand, archiveStartMain, server, browser, start, state, updateAndSettle, navigate, until, sleep, tmpDir, READY, seenHosts,
} from './helpers.mjs';

const EXT = 'ttg-ext-supabase-' + fs.readFileSync(new URL('../../src/supabase.js', import.meta.url), 'utf8').match(/supabase-js@([\d.]+)/)[1];
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const G = process.env.TTG_SW_GEGENPROBE || ''; // G2 | G3 | G6 (Gegenproben: das Szenario MUSS dann rot werden)

function checks() {
  const list = [];
  const ok = (name, cond, info = '') => { list.push({ ok: !!cond, name, info }); return !!cond; };
  return { list, ok };
}

/** Pfade (ohne Query) zählen: { pfad: n } */
const tally = (log) => log.reduce((m, p) => { m[p] = (m[p] ?? 0) + 1; return m; }, {});

// Edits der Gegenproben in Kopien des Branch-Stands
const G2_EDIT = (t) => t.replace(
  'files = await Promise.all(SHELL.map(grab));\n    const cache = await caches.open(VERSION);\n    await Promise.all(files.map(([url, res]) => cache.put(url, res)));',
  'const cache = await caches.open(VERSION);\n    await cache.addAll(SHELL);',
);
const G3_EDIT = (t) => t
  .replace("self.addEventListener('install', (e) => { e.waitUntil(precache()); });", "self.addEventListener('install', (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });")
  .replace('.map((k) => caches.delete(k)))));\n});', '.map((k) => caches.delete(k)))).then(() => self.clients.claim()));\n});');

/** Ein Stand des Branch-Standes mit eigener VERSION und Stempel. */
const branch = (name, n, extra = {}) => makeStand(name, { version: `ttg-v${n}`, stamp: name, ...extra });

/** Zwei Starts unter dem Worker; danach steuert er die Seite (der erste Start installiert nur). */
async function twoStarts(ctx, s, c, label) {
  const p1 = await start(ctx, s.url);
  await until(async () => (await state(p1)).active === 'activated', 30000);
  const p2 = await start(ctx, s.url);
  const st = await state(p2);
  c.ok(`${label}: nach zwei Starts steuert der Worker`, st.controller && st.active === 'activated', JSON.stringify(st));
  return p2;
}

/** Ruhiger Wechsel #/login → #/datenschutz mit wartender Version ⇒ genau ein load, danach nur der neue Stempel. */
async function takeOver(p, c, label, to) {
  const loads0 = p.loads;
  await navigate(p, '#/datenschutz', { settle: 2500 });
  const st = await state(p);
  const loads = p.loads - loads0;
  c.ok(`${label}: genau ein load des Hauptrahmens`, loads === 1, `loads=${loads}`);
  c.ok(`${label}: Stempelmenge {${to.stamp}}`, same(st.stamps, [to.stamp]), `stamps=${JSON.stringify(st.stamps)}`);
  c.ok(`${label}: caches.keys() = ${to.version} + Ext`, same(st.keys, [to.version, EXT]), `keys=${JSON.stringify(st.keys)}`);
  // #/datenschutz zeigt keine Versionsnummer — sie steht auf #/einstellungen/rechtliches (ebenfalls ruhig, nichts wartet mehr)
  const l1 = p.loads;
  await navigate(p, '#/einstellungen/rechtliches', { settle: 300 });
  const sv = await state(p);
  st.version = sv.version;
  c.ok(`${label}: data-version (#/einstellungen/rechtliches) zeigt ${to.version.replace('ttg-', '')}, kein weiteres load`, (sv.version ?? '').includes(to.version.replace('ttg-', '')) && p.loads === l1, `data-version=${sv.version} loads=${p.loads - l1}`);
  c.ok(`${label}: kein pageerror`, p.errors.length === 0, p.errors.join(' | '));
  await navigate(p, '#/login', { settle: 300 });
  return { loads, st };
}

// ---------------------------------------------------------------- S1 Eichung
export async function S1() {
  const c = checks();
  const A = branch('A', 901);
  const s = await server(A);
  const prof = tmpDir('profil-s1');
  // (a) erster Start OHNE Service Worker: das Protokoll zählt jede Anfrage
  let ctx = await browser(prof, { sw: false });
  s.clear();
  let p = await start(ctx, s.url);
  await sleep(2000);
  const first = s.log.length;
  const t = tally(s.log);
  const shell = fs.readFileSync(path.join(A.dir, 'sw.js'), 'utf8');
  const dup = Object.entries(t).filter(([k, n]) => n > 1 && shell.includes(`'.${k}'`));
  c.ok('S1a erster Start ohne Worker ⇒ mehr als 50 Anfragen', first > 50, `anfragen=${first}`);
  c.ok('S1a jede SHELL-Datei des Login-Wegs höchstens einmal', dup.length === 0, JSON.stringify(dup));
  c.ok('S1a ohne Schalter: keine Registrierung', (await p.evaluate(() => navigator.serviceWorker.getRegistrations())).length === 0);
  await ctx.close();
  // (b) zwei Starts unter dem Worker, dann „Netz aus“: Server zu + Browser-Neustart mit Resolver-Regel
  ctx = await browser(prof);
  await twoStarts(ctx, s, c, 'S1b');
  await ctx.close();
  if (G !== 'G6') await s.close();
  ctx = await browser(prof, { offline: true, rule: G !== 'G6' });
  try {
    p = await start(ctx, s.url);
    const eich = await p.evaluate(async (rnd) => {
      const tryIt = async (u) => { try { await fetch(u); return 'gelungen'; } catch { return 'gescheitert'; } };
      return { eigen: await tryIt(`./eichung-${rnd}.js`), fremd: await tryIt(`https://esm.sh/eichung-${rnd}`) };
    }, String(Date.now()));
    if (eich.eigen !== 'gescheitert' || eich.fremd !== 'gescheitert') {
      throw new Abort(`S1b Messgerät untauglich: Eich-Abrufe eigen=${eich.eigen}, esm.sh=${eich.fremd} (beide müssen scheitern)`);
    }
    c.ok('S1b Eichung: eigene Adresse ohne Cache und esm.sh scheitern offline', true, JSON.stringify(eich));
    // Positivkontrolle des K27-Zählers: ein fremder Abruf aus der gesteuerten Seite nimmt denselben Weg wie
    // supabase.co (kein respondWith) und verlässt den Rechner nicht (.invalid, Resolver-Regel). Sieht der
    // Kontext-Zähler ihn nicht, wäre „0 Anfragen an *.supabase.co“ wertlos ⇒ Messgerät untauglich.
    const ctrl = await p.evaluate(async () => {
      try { await fetch('https://eichung.invalid/k27'); } catch { /* scheitert erwartungsgemäß */ }
      return !!navigator.serviceWorker.controller;
    });
    await sleep(300);
    if (!ctrl || !seenHosts.has('eichung.invalid')) throw new Abort(`S1b Messgerät untauglich: K27-Zähler sieht fremde Abrufe nicht (gesteuert=${ctrl})`);
    c.ok('S1b K27-Zähler sieht fremde Abrufe aus der gesteuerten Seite (Positivkontrolle eichung.invalid)', true);
  } finally {
    await ctx.close();
    await s.close();
  }
  return { checks: c.list, line: `S1 · erster Start ohne Worker: ${first} Anfragen (${Object.keys(t).length} Pfade, Doppelte in SHELL: ${dup.length}) · Eichung offline: beide Abrufe gescheitert` };
}

// ---------------------------------------------------------------- S2 Zweiter Start
export async function S2() {
  const c = checks();
  const A = branch('A', 901);
  const s = await server(A);
  const prof = tmpDir('profil-s2');
  let ctx = await browser(prof);
  s.clear();
  await start(ctx, s.url);
  await sleep(1500);
  const firstWithSw = s.log.length;
  await ctx.close();
  ctx = await browser(prof);
  await twoStarts(ctx, s, c, 'S2');
  await ctx.close();
  // Kaltstart: Browser-Neustart, Protokoll leer
  ctx = await browser(prof);
  s.clear();
  const p = await start(ctx, s.url);
  await sleep(2000);
  const t = tally(s.log);
  const other = Object.keys(t).filter((k) => k !== '/sw.js');
  c.ok('S2 Kaltstart: nur /sw.js (höchstens 2), 0 andere Pfade', other.length === 0 && (t['/sw.js'] ?? 0) <= 2, JSON.stringify(t));
  const delivery = await p.evaluate(() => performance.getEntriesByType('navigation')[0]?.deliveryType ?? '');
  c.ok('S2 Navigation aus dem Cache (deliveryType cache-storage)', delivery === 'cache-storage', delivery);
  c.ok('S2 kein pageerror', p.errors.length === 0, p.errors.join(' | '));
  await ctx.close();
  await s.close();
  return { checks: c.list, line: `S2 · Kaltstart unter dem Worker: ${s.log.length} Anfragen ${JSON.stringify(t)} · zum Vergleich erster Start mit Worker (inkl. Precache): ${firstWithSw}` };
}

// ---------------------------------------------------------------- S3 Versionswechsel unter max-age=600
async function s3Core(c, s, ctx, A, B, label = 'S3') {
  const p = await twoStarts(ctx, s, c, label);
  s.use(B);
  const st = await updateAndSettle(p);
  c.ok(`${label}: registration.waiting gesetzt`, st.waiting, JSON.stringify(st));
  c.ok(`${label}: Seite weiter mit Stempelmenge {${A.stamp}}`, same(st.stamps, [A.stamp]), JSON.stringify(st.stamps));
  const r = await takeOver(p, c, label, B);
  return { p, ...r };
}

export async function S3() {
  const c = checks();
  const A = branch('A', 901);
  const B = branch('B', 902, G === 'G2' ? { edits: { 'sw.js': G2_EDIT } } : {});
  const s = await server(A, { cacheControl: 'max-age=600' });
  const ctx = await browser(tmpDir('profil-s3'));
  let res;
  try { res = await s3Core(c, s, ctx, A, B); } finally { await ctx.close(); await s.close(); }
  return { checks: c.list, line: `S3 · max-age=600 · load=${res.loads} · Stempel ${JSON.stringify(res.st.stamps)} · caches ${JSON.stringify(res.st.keys)} · data-version „${res.st.version}“ · pageerror ${res.p.errors.length}` };
}

// ---------------------------------------------------------------- S4 Halten
export async function S4() {
  const c = checks();
  const A = branch('A', 901);
  const B = branch('B', 902, G === 'G3' ? { edits: { 'sw.js': G3_EDIT } } : {});
  const s = await server(A);
  const ctx = await browser(tmpDir('profil-s4'));
  const out = [];
  try {
    const p = await twoStarts(ctx, s, c, 'S4');
    s.use(B);
    let st = await updateAndSettle(p);
    c.ok('S4 B wartet', st.waiting, JSON.stringify(st));
    let l0 = p.loads;
    await navigate(p, '#/passwort-vergessen');
    st = await state(p);
    c.ok('S4 #/login → #/passwort-vergessen: kein load, {A}, waiting', p.loads === l0 && same(st.stamps, ['A']) && st.waiting, `loads=${p.loads - l0} ${JSON.stringify(st)}`);
    out.push(`login→passwort-vergessen load=${p.loads - l0}`);
    l0 = p.loads;
    await navigate(p, '#/login');
    st = await state(p);
    c.ok('S4 #/passwort-vergessen → #/login: kein load (Herkunft nicht ruhig)', p.loads === l0 && same(st.stamps, ['A']) && st.waiting, `loads=${p.loads - l0} ${JSON.stringify(st)}`);
    out.push(`passwort-vergessen→login load=${p.loads - l0}`);
    // zweite Seite im selben Kontext
    const q = await start(ctx, s.url, '#/login', { closeOthers: false });
    await sleep(5000); // q versucht beim Start selbst (Ziel ruhig) — der Worker lehnt ab, q wartet 4 s
    const ql0 = q.loads;
    l0 = p.loads;
    await navigate(p, '#/datenschutz', { settle: 5500 });
    st = await state(p);
    const sq = await state(q);
    c.ok('S4 zwei Seiten: #/login → #/datenschutz ⇒ kein load in beiden, {A}', p.loads === l0 && q.loads === ql0 && same(st.stamps, ['A']) && same(sq.stamps, ['A']) && st.waiting,
      `loads p=${p.loads - l0} q=${q.loads - ql0} ${JSON.stringify(st)}`);
    out.push(`zwei Seiten load p=${p.loads - l0} q=${q.loads - ql0}`);
    await q.close();
    // Schleifenschutz: der abgelehnte Versuch eben setzte ttg.swap ⇒ 30 s warten (Konstante nicht verkürzt)
    await sleep(31000);
    l0 = p.loads;
    await navigate(p, '#/login', { settle: 2500 });
    st = await state(p);
    c.ok('S4 zweite Seite zu, nächster ruhiger Wechsel ⇒ genau ein load, {B}', p.loads - l0 === 1 && same(st.stamps, ['B']), `loads=${p.loads - l0} ${JSON.stringify(st)}`);
    c.ok('S4 kein pageerror', p.errors.length === 0, p.errors.join(' | '));
    out.push(`danach allein load=${p.loads - l0} stamps=${JSON.stringify(st.stamps)} caches=${JSON.stringify(st.keys)}`);
  } finally { await ctx.close(); await s.close(); }
  return { checks: c.list, line: `S4 · ${out.join(' · ')}` };
}

// ---------------------------------------------------------------- S5 Kaputte Auslieferung
export async function S5() {
  const c = checks();
  const A = branch('A', 901);
  const B = branch('B', 902);
  const Bi = branch('Bx', 902, { remove: ['src/views/soon.js'] });
  const s = await server(A);
  const ctx = await browser(tmpDir('profil-s5'));
  const out = [];
  try {
    let p = await twoStarts(ctx, s, c, 'S5');
    const cases = [
      ['(i) 404', Bi, null],
      ['(ii) Abbruch im Rumpf', B, (req, res, rel) => {
        if (rel !== '/assets/icons/logo-dark.png') return false;
        const buf = fs.readFileSync(path.join(B.dir, 'assets/icons/logo-dark.png'));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
        res.write(buf.subarray(0, buf.length >> 1));
        setTimeout(() => res.destroy(), 20);
        return true;
      }],
      ['(iii) .js als 200 text/html', B, (req, res, rel) => {
        if (rel !== '/src/lib/format.js') return false;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end('<!doctype html><title>Fehler</title>');
        return true;
      }],
    ];
    for (const [name, stand, fault] of cases) {
      s.use(stand);
      s.fault = fault;
      let st;
      for (let i = 0; i < 3; i++) st = await updateAndSettle(p);
      s.fault = null;
      const l0 = p.loads;
      c.ok(`S5 ${name}: waiting null, nichts installiert`, !st.waiting && !st.installing, JSON.stringify(st));
      c.ok(`S5 ${name}: aktiver Worker unverändert (kein controllerchange)`, st.cc === 0 && st.controller, `cc=${st.cc}`);
      c.ok(`S5 ${name}: caches.keys() = ttg-v901 + Ext`, same(st.keys, ['ttg-v901', EXT]), JSON.stringify(st.keys));
      await navigate(p, '#/einstellungen/rechtliches');
      const st2 = await state(p);
      c.ok(`S5 ${name}: App auf A bedienbar (ruhiger Wechsel zeichnet, {A}, kein load)`, p.loads === l0 && same(st2.stamps, ['A']) && (st2.version ?? '').includes('v901'), `loads=${p.loads - l0} ${JSON.stringify(st2)}`);
      out.push(`${name}: waiting=${st.waiting} caches=${JSON.stringify(st.keys)} load=${p.loads - l0} stamps=${JSON.stringify(st2.stamps)}`);
      await navigate(p, '#/login');
      s.use(A);
    }
    // danach heiler Stand B ⇒ S3 läuft durch (frischer Start, dann Übernahme)
    p = await start(ctx, s.url);
    s.use(B);
    const st = await updateAndSettle(p);
    c.ok('S5 danach heiler B: wartet', st.waiting, JSON.stringify(st));
    const r = await takeOver(p, c, 'S5 danach heiler B', B);
    out.push(`heiler B: load=${r.loads} stamps=${JSON.stringify(r.st.stamps)}`);
  } finally { await ctx.close(); await s.close(); }
  return { checks: c.list, line: `S5 · ${out.join(' · ')}` };
}

// ---------------------------------------------------------------- S6 Ohne Netz
const VIEWS = fs.readdirSync(new URL('../../src/views/', import.meta.url)).filter((f) => f.endsWith('.js'));

async function offlineCheck(c, prof, s, A, label) {
  await s.close();
  const ctx = await browser(prof, { offline: true });
  const res = { foreign: [] };
  try {
    const p = await start(ctx, s.url);
    for (const h of ['#/login', '#/registrieren', '#/passwort-vergessen', '#/einstellungen/rechtliches']) {
      await navigate(p, h, { settle: 300 });
      const st = await state(p);
      c.ok(`${label} ${h} zeichnet ohne Netz`, !st.errorView, JSON.stringify(st));
    }
    const imp = await p.evaluate(async (views) => {
      const r = await Promise.allSettled(views.map((v) => import(`./src/views/${v}`)));
      return r.map((x, i) => (x.status === 'fulfilled' ? null : `${views[i]}: ${x.reason}`)).filter(Boolean);
    }, VIEWS);
    c.ok(`${label} import() jeder Datei unter src/views/ (${VIEWS.length})`, imp.length === 0, imp.join(' | '));
    const shell = await p.evaluate(async (src) => {
      const list = [...src.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const bad = [];
      for (const u of list) { try { const r = await fetch(u); if (!r.ok) bad.push(`${u} ${r.status}`); } catch (e) { bad.push(`${u} ${e.message}`); } }
      return { n: list.length, bad };
    }, fs.readFileSync(path.join(A.dir, 'sw.js'), 'utf8'));
    c.ok(`${label} fetch jeder SHELL-Adresse ok (${shell.n})`, shell.bad.length === 0, shell.bad.join(' | '));
    c.ok(`${label} kein pageerror`, p.errors.length === 0, p.errors.join(' | '));
    const own = p.consoleErrors.filter((e) => { try { return new URL(e.url).hostname === 'localhost'; } catch { return true; } });
    c.ok(`${label} Konsolenfehler nur für fremde Hosts`, own.length === 0, JSON.stringify(own));
    res.foreign = [...new Set(p.consoleErrors.map((e) => `${e.text.slice(0, 60)} @ ${e.url.split('?')[0]}`))];
    res.shell = shell.n;
  } finally { await ctx.close(); await s.restart(); }
  return res;
}

export async function S6() {
  const c = checks();
  const A = branch('A', 901);
  const B = branch('B', 902);
  const s = await server(A);
  const prof = tmpDir('profil-s6');
  let ctx = await browser(prof);
  await twoStarts(ctx, s, c, 'S6');
  await ctx.close();
  const r1 = await offlineCheck(c, prof, s, A, 'S6 (A)');
  // derselbe Lauf direkt nach einem Versionswechsel (belegt E4: supabase-js aus dem Ext-Cache)
  ctx = await browser(prof);
  try {
    const p = await start(ctx, s.url);
    s.use(B);
    const st = await updateAndSettle(p);
    c.ok('S6 Versionswechsel: B wartet', st.waiting, JSON.stringify(st));
    await takeOver(p, c, 'S6 Versionswechsel', B);
  } finally { await ctx.close(); }
  const r2 = await offlineCheck(c, prof, s, B, 'S6 (nach Wechsel auf B)');
  await s.close();
  return { checks: c.list, line: `S6 · ohne Netz: 4 Routen, ${VIEWS.length} Views, ${r1.shell} SHELL-Adressen (A) / ${r2.shell} (B) · erlaubte Konsolenfehler (fremde Hosts): ${JSON.stringify([...new Set([...r1.foreign, ...r2.foreign])])}` };
}

// ---------------------------------------------------------------- S7 Übergang vom heutigen Worker
async function s7Run(c, label, nVersion) {
  const { dir, ref } = archiveStartMain();
  const O = makeStand('O', {
    from: dir, stamp: 'O',
    edits: { 'src/main.js': (t) => t.replace("'serviceWorker' in navigator && location.protocol === 'https:'", "'serviceWorker' in navigator") },
  });
  const oVersion = fs.readFileSync(path.join(O.dir, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/)[1];
  const n = nVersion === 'gleich' ? Number(oVersion.replace('ttg-v', '')) : Number(oVersion.replace('ttg-v', '')) + 1;
  const N = branch('N', n);
  const s = await server(O);
  const prof = tmpDir('profil-s7');
  const ctx = await browser(prof);
  const lines = [];
  try {
    const p1 = await start(ctx, s.url);
    await until(async () => (await state(p1)).controller, 20000);
    const p2 = await start(ctx, s.url);
    const so = await state(p2);
    c.ok(`${label}: alter Worker steuert (Stand O, ${oVersion}, ${ref.slice(0, 7)})`, so.controller && so.keys.includes(oVersion), JSON.stringify(so));
    s.use(N);
    let st;
    let starts = 0;
    for (; starts < 2; starts++) {
      const p = await start(ctx, s.url);
      await until(async () => { const x = await state(p); return !x.installing; }, 30000);
      await sleep(1000);
      st = await state(p);
      if (st.controller && same(st.keys, [N.version, EXT]) && same(st.stamps, ['N'])) break;
    }
    const pf = ctx.pages()[0];
    st = await state(pf);
    c.ok(`${label}: nach höchstens zwei Starts steuert der neue Worker, caches = ${N.version} + Ext`, starts < 2 && st.controller && same(st.keys, [N.version, EXT]), `starts=${starts + 1} ${JSON.stringify(st)}`);
    c.ok(`${label}: Stempelmenge einelementig`, st.stamps.length === 1, JSON.stringify(st.stamps));
    c.ok(`${label}: kein pageerror`, pf.errors.length === 0, pf.errors.join(' | '));
    lines.push(`${label}: O=${oVersion} → N=${N.version}, Starts=${starts + 1}, caches=${JSON.stringify(st.keys)}, stamps=${JSON.stringify(st.stamps)}`);
  } finally { await ctx.close(); await s.close(); }
  return lines;
}

export async function S7() {
  const c = checks();
  const l1 = await s7Run(c, 'S7 VERSION+1', 'plus1');
  const l2 = await s7Run(c, 'S7 VERSION gleich', 'gleich');
  return { checks: c.list, line: `S7 · ${[...l1, ...l2].join(' · ')}` };
}

// ---------------------------------------------------------------- S8 Notfall
export async function S8() {
  const c = checks();
  const A = branch('A', 901);
  const K = branch('K', 902, { edits: { 'src/main.js': (t) => `throw new Error('Stand K: kaputt');\n${t}` } });
  const F = branch('F', 903, { edits: { 'sw.js': (t) => t.replace('const URGENT = false;', 'const URGENT = true;') } });
  const s = await server(A);
  const ctx = await browser(tmpDir('profil-s8'));
  const out = [];
  try {
    const p = await twoStarts(ctx, s, c, 'S8');
    s.use(K);
    const st = await updateAndSettle(p);
    c.ok('S8 K wartet', st.waiting, JSON.stringify(st));
    // K wird übernommen: alle Fenster zu ⇒ der wartende Worker übernimmt beim nächsten Start
    const pk = await start(ctx, s.url, '#/login', { ready: false });
    await sleep(3000);
    const sk = await state(pk);
    const broken = !(await pk.$(READY['#/login'])) && pk.errors.some((e) => /Stand K/.test(e));
    c.ok('S8 Stand K übernommen ⇒ App startet nicht', broken && same(sk.keys, ['ttg-v902', EXT]), `${JSON.stringify(sk)} errors=${pk.errors.join(' | ')}`);
    out.push(`K: caches=${JSON.stringify(sk.keys)} startet=${!broken}`);
    s.use(F);
    let starts = 0;
    let ok = false;
    let sf;
    for (; starts < 2 && !ok; starts++) {
      const pf = await start(ctx, s.url, '#/login', { ready: false });
      ok = !!(await pf.waitForSelector(READY['#/login'], { timeout: 8000 }).catch(() => null));
      await until(async () => !(await state(pf)).installing, 30000);
      sf = await state(pf);
      ok = ok && same(sf.stamps, ['F']);
    }
    c.ok('S8 Stand F (URGENT) ⇒ nach höchstens zwei Starts läuft die App (Login-Formular, {F}), ohne Speicher zu löschen', ok, `starts=${starts} ${JSON.stringify(sf)}`);
    out.push(`F: Starts=${starts} stamps=${JSON.stringify(sf?.stamps)} caches=${JSON.stringify(sf?.keys)}`);
  } finally { await ctx.close(); await s.close(); }
  return { checks: c.list, line: `S8 · ${out.join(' · ')}` };
}

// ---------------------------------------------------------------- T Zeitmessung (informativ)
export async function T() {
  const A = branch('A', 901);
  const s = await server(A);
  const first = [];
  const second = [];
  try {
    for (let i = 0; i < 5; i++) {
      const prof = tmpDir('profil-t');
      const ctx = await browser(prof);
      const p1 = await start(ctx, s.url);
      first.push(p1.readyMs);
      await until(async () => (await state(p1)).active === 'activated', 30000);
      await ctx.close();
      const ctx2 = await browser(prof);
      await start(ctx2, s.url); // installiert war schon; dieser Start steuert bereits
      const p2 = await start(ctx2, s.url);
      second.push(p2.readyMs);
      await ctx2.close();
    }
  } finally { await s.close(); }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  return { checks: [], line: `T · Seitenaufruf bis Login-Formular: erster Start ${JSON.stringify(first)} ms (Median ${med(first)}) · zweiter Start unter dem Worker ${JSON.stringify(second)} ms (Median ${med(second)}) · localhost, sagt nichts über das iPhone` };
}
