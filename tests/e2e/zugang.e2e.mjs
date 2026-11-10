// E2E Zugang (Spec P9b, Kriterien 1–9, 13, 15): Einladungsseite, Registrierung mit Code, Willkommen ohne Gruppe,
// Beitritt mit bestehendem Konto, Einladungs-Karte + QR, Rollen-Knopf, Verwaltung, Bildschirmfotos in drei Looks.
// Schreibschutz: jede Seite bekommt zuerst eine Sperre (guard), die Registrierung und alle Superadmin-RPCs
// abfängt und NIE an Prod weiterreicht — ein abgefangenes is_superadmin darf nichts Echtes auslösen.
// Echt (Prod, nur Fixture): B tritt über den Fixture-Link bei, C übernimmt einen Platzhalter, A sieht die Karte.
// Tor-Fälle (Krit. 13) nur bei zugangLive() — sonst je Fall sichtbar übersprungen (Dirigent nach dem db push).
// Der Teil ohne Anmeldung (anonPart) braucht nur { browser, base } und läuft auch offline (alle Supabase-Anfragen
// abgefangen) — so fährt die Gegenprobe gegen den Start-main ohne zusätzlichen Lauf gegen Prod.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import jsQR from 'jsqr';
import {
  ok, skip, ctx, waitHash, login, ensureMember, ensurePlaceholder, zugangLive, inviteCode, fixtureIds, get, rpc,
  TARGET, ROOT, FIXTURE_NAME,
} from './harness.mjs';
import { email, password } from './fixture-api.mjs';
import de from '../../src/i18n/de.js';

const SB = TARGET.url;
const LOOKS = ['nacht', 'arktis', 'lachs'];
const VW = { width: 375, height: 812 };
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const OK_INVITE = json(200, { status: 'ok', group_name: FIXTURE_NAME });
/** Plus-Adresse von A (aus der lokalen Datei abgeleitet, nie ausgegeben); im UI-Teil nur gegen abgefangene Aufrufe. */
const plus = (tag) => email('a').replace('@', `+${tag}@`);

// ---------------------------------------------------------------- Helfer
/** Sperre auf Kontext-Ebene: nichts davon erreicht Prod (Seiten-Mocks haben Vorrang). */
async function guard(p, { allowRenew = false } = {}) {
  const block = ['auth/v1/signup', 'rest/v1/rpc/create_playgroup', 'rest/v1/rpc/set_member_role', 'rest/v1/rpc/set_max_accounts',
    'rest/v1/rpc/access_overview', ...(allowRenew ? [] : ['rest/v1/rpc/renew_invite'])];
  for (const b of block) await p.context().route(`${SB}/${b}*`, (r) => r.fulfill(json(418, { code: 'E2E', message: 'e2e_blocked' })));
}

/** Eigenes Profil beim Laden ergänzen (is_superadmin) — nur GET des eigenen Profils, sonst unverändert. */
async function profileMock(p, uid, ov) {
  await p.route(`${SB}/rest/v1/profiles?*`, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET' || !req.url().includes(`id=eq.${uid}`) || !ov.superadmin) return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    const patch = (o) => ({ ...o, is_superadmin: true });
    await route.fulfill({ response: res, body: JSON.stringify(Array.isArray(body) ? body.map(patch) : patch(body)) });
  });
}

async function page(browser, name, opts) {
  const p = await ctx(browser, name);
  await p.setViewportSize(VW);
  await guard(p, opts);
  return p;
}

/** Frisch laden (eigenes Dokument, kein veraltetes Element der vorigen Ansicht). */
async function fresh(p, base, h) {
  await p.goto('about:blank');
  await p.goto(base + h);
}

async function setLook(p, l) {
  await p.evaluate((x) => { document.documentElement.dataset.theme = x; try { localStorage.setItem('ttg.theme', x); } catch { /* privat */ } }, l);
}

async function fits(p) {
  return p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const small = [...document.querySelectorAll('.btn')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden' && r.height < 43.5;
    }).map((b) => `${(b.dataset.act || b.textContent || '').trim().slice(0, 24)}:${Math.round(b.getBoundingClientRect().height)}`);
    return { wide: document.documentElement.scrollWidth > vw + 1, sw: document.documentElement.scrollWidth, vw, small };
  });
}

/** Krit 15: Bildschirmfoto in allen drei Looks + Breite/Knopfhöhe. */
async function screens(p, name) {
  for (const l of LOOKS) {
    await setLook(p, l);
    await p.waitForTimeout(120);
    await p.shot(`${name}-${l}`);
    const f = await fits(p);
    ok(`K15 ${name} (${l}, 375×812): kein waagrechtes Scrollen, Knöpfe ≥ 44 px`, !f.wide && f.small.length === 0, JSON.stringify(f));
  }
  await setLook(p, 'nacht');
}

/** Abschnitt isolieren: ein Zeitüberlauf kostet nur diesen Abschnitt, nicht die Belege der folgenden. */
async function section(name, pages, fn) {
  console.log(`\nZugang: ${name}`);
  try { await fn(); return true; } catch (e) {
    ok(`${name}: Abschnitt lief durch`, false, String(e?.message || e).split('\n')[0].slice(0, 240));
    for (const p of pages) await p?.shot?.(`fehler-${name.replace(/[^\wäöüÄÖÜ]+/g, '-')}`).catch(() => {});
    return false;
  }
}

/** PNG (Bildschirmfoto) im Browser auf ein Canvas legen, Bildpunkte zurück, in Node mit jsQR lesen. */
async function decodePng(decoder, buf) {
  const px = await decoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, data: Array.from(d.data) };
  }, buf.toString('base64'));
  return jsQR(Uint8ClampedArray.from(px.data), px.w, px.h)?.data ?? null;
}

function footer(pages, expected = {}, expectedErrs = {}) {
  for (const [n, p] of pages) {
    // errText (src/lib/ui.js) protokolliert unbekannte Fehler — beim abgefangenen 500er gewollt
    const errs = p.errs.filter((e) => !(expectedErrs[n] ?? []).some((re) => re.test(e)));
    ok(`Keine JS-Fehler bei ${n}`, errs.length === 0, errs.join(' | ').slice(0, 400));
    const allow = new Set(expected[n] ?? []);
    const unexpected = p.bad.filter((x) => !allow.has(x));
    ok(`Keine unerwarteten HTTP-Fehler bei ${n}`, unexpected.length === 0, JSON.stringify(unexpected));
  }
}

// ---------------------------------------------------------------- Teil ohne Anmeldung (Krit 1–3, Fotos)
/**
 * @param {{ browser: any, base: string, offline?: boolean }} o — offline: jede nicht abgefangene Supabase-Anfrage scheitert
 */
export async function anonPart({ browser, base, offline = false }) {
  const P = await ctx(browser, 'ZP');
  if (offline) await P.context().route(`${SB}/**`, (r) => r.abort());
  await P.setViewportSize(VW);
  await guard(P);
  let checkQ = [OK_INVITE];
  let checks = 0;
  await P.route(`${SB}/rest/v1/rpc/check_invite*`, (r) => { checks++; return r.fulfill(checkQ.length > 1 ? checkQ.shift() : checkQ[0]); });
  const mockCheck = (...rs) => { checkQ = rs; };
  const signups = [];
  let signupRes = json(200, { id: '00000000-0000-4000-8000-0000000000e2', aud: 'authenticated', role: '', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-11-10T00:00:00Z' });
  await P.route(`${SB}/auth/v1/signup*`, (r) => { signups.push(r.request().postDataJSON()); return r.fulfill(signupRes); });

  const state = async () => P.evaluate(() => {
    const s = document.querySelector('[data-state]');
    return { s: s?.dataset.state ?? null, text: document.querySelector('#app, main, body').innerText, create: !!document.querySelector('[data-act="create-account"]'), have: !!document.querySelector('[data-act="have-account"]') };
  });
  const openJoin = async (h) => { await fresh(P, base, h); await P.waitForSelector('[data-state]'); return state(); };

  await section('Krit 1 Routen', [P], async () => {
    mockCheck(OK_INVITE);
    const a = await openJoin('#/code/TTG-ROUTE1');
    const b = await openJoin('#/beitreten/TTG-ROUTE1');
    ok('K1 #/code/<code> und #/beitreten/<code> zeigen dieselbe Seite (Zustand, Gruppenname, beide Knöpfe)',
      a.s === 'invite' && b.s === 'invite' && a.create && b.create && a.have && b.have && a.text.includes(FIXTURE_NAME) && b.text.includes(FIXTURE_NAME),
      JSON.stringify({ a: a.s, b: b.s }));
    ok('K1 src/views/code.js existiert nicht', !fs.existsSync(path.join(ROOT, 'src', 'views', 'code.js')));
    let diff = null;
    try { diff = execFileSync('git', ['-C', ROOT, 'diff', '--unified=0', 'main...HEAD', '--', 'src/main.js'], { encoding: 'utf8', timeout: 20000 }); } catch { /* kein main */ }
    if (diff === null) skip('K1 git diff main...HEAD -- src/main.js nur Routenzeilen', 'Zweig main nicht auffindbar');
    else {
      const lines = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
      ok('K1 git diff main...HEAD -- src/main.js berührt nur Routenzeilen', lines.every((l) => /^[+-]route\(/.test(l)), JSON.stringify(lines));
    }
  });

  await section('Krit 2 Einladung ohne Sitzung', [P], async () => {
    mockCheck(OK_INVITE);
    let s = await openJoin('#/beitreten/TTG-OKAAAA');
    ok('K2 ok ⇒ Gruppenname + „Konto erstellen“ + „Ich habe schon ein Konto“', s.s === 'invite' && s.text.includes(FIXTURE_NAME) && s.create && s.have, JSON.stringify({ s: s.s, c: s.create, h: s.have }));
    await screens(P, 'einladung');

    mockCheck(json(200, { status: 'invalid' }));
    s = await openJoin('#/beitreten/TTG-INVAAA');
    ok('K2 invalid ⇒ Meldung „kennen wir nicht (mehr)“, kein „Konto erstellen“', s.s === 'invalid' && s.text.includes(de.access.invalid) && !s.create, s.s);
    ok('K2 invalid ⇒ Feld „Code oder Link“ zum Neu-Eingeben', (await P.locator('#jn-code').count()) === 1);

    mockCheck(json(200, { status: 'full' }));
    s = await openJoin('#/beitreten/TTG-FULAAA');
    ok('K2 full ⇒ „Zurzeit sind alle Plätze vergeben“, kein „Konto erstellen“, Anmeldung bleibt', s.s === 'full' && s.text.includes('Zurzeit sind alle Plätze vergeben') && !s.create && s.have, s.s);
    await screens(P, 'voll');

    mockCheck(json(404, { code: 'PGRST202', message: 'Could not find the function public.check_invite(p_code) in the schema cache' }));
    s = await openJoin('#/beitreten/TTG-UNKAAA');
    ok('K2 404 PGRST202 ⇒ beide Knöpfe, ohne Gruppenname', s.s === 'invite' && s.create && s.have && !s.text.includes(FIXTURE_NAME) && s.text.includes(de.access.invitedNoName), s.s);

    mockCheck(json(500, { code: 'XX000', message: 'boom' }));
    s = await openJoin('#/beitreten/TTG-ERRAAA');
    ok('K2 500 ⇒ Fehlermeldung, kein „Konto erstellen“', s.s === 'error' && !s.create && (await P.locator('[data-state="error"] .error').count()) === 1, s.s);
  });

  await section('Krit 3 Registrierung', [P], async () => {
    mockCheck(OK_INVITE);
    await openJoin('#/beitreten/ttg-abc234');
    await P.click('[data-act="create-account"]');
    await waitHash(P, '#/registrieren');
    await P.waitForSelector('#rg-code');
    ok('K3 #rg-code aus dem Link vorbelegt (normalisiert)', (await P.inputValue('#rg-code')) === 'TTG-ABC234', await P.inputValue('#rg-code'));
    await screens(P, 'registrierung');

    const fill = async (code) => {
      await P.fill('#rg-code', code);
      await P.fill('#rg-name', 'E2E Neu');
      await P.fill('#rg-mail', plus('p9bui'));
      await P.fill('#rg-pass', password());
    };
    const submit = () => P.click('form button[type=submit]');
    const codeErr = () => P.evaluate(() => { const e = document.querySelector('[data-code-err]'); return e && !e.hidden ? e.textContent : null; });

    await fill('');
    const c0 = checks;
    await submit();
    await P.waitForFunction(() => !document.querySelector('[data-code-err]').hidden);
    ok('K3 leerer Code ⇒ Feldfehler, kein signup, keine Prüfung', signups.length === 0 && checks === c0 && (await codeErr()) === de.auth.errors.signup_code_required, String(await codeErr()));

    mockCheck(json(200, { status: 'invalid' }));
    await fill('ttg-falsch1');
    await submit();
    await P.waitForFunction((t) => document.querySelector('[data-code-err]')?.textContent === t && !document.querySelector('[data-code-err]').hidden, de.auth.errors.signup_code_invalid);
    ok('K3 invalid ⇒ Feldfehler, kein signup', signups.length === 0);

    mockCheck(OK_INVITE);
    await fill(' ttg-abc234 ');
    await submit();
    await P.waitForSelector('[data-confirm]');
    const d = signups[0]?.data ?? {};
    ok('K3 ok ⇒ signup trägt data.invite_code (normalisiert) und data.display_name', signups.length === 1 && d.invite_code === 'TTG-ABC234' && d.display_name === 'E2E Neu',
      JSON.stringify({ n: signups.length, invite_code: d.invite_code, display_name: d.display_name }));

    await fresh(P, base, '#/registrieren');
    await P.waitForSelector('#rg-code');
    mockCheck(OK_INVITE, json(200, { status: 'full' }));
    signupRes = json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user', message: 'Database error saving new user' });
    await fill('TTG-ABC234');
    await submit();
    await P.waitForSelector('form [data-state="full"]');
    ok('K3 signup 500 „Database error saving new user“ + danach full ⇒ „alle Plätze vergeben“',
      signups.length === 2 && (await P.textContent('form [data-state="full"]')).includes('Zurzeit sind alle Plätze vergeben'));
  });

  footer([['ZP', P]], { ZP: [`500 ${SB}/rest/v1/rpc/check_invite`, `500 ${SB}/auth/v1/signup`] }, { ZP: [/^console: .*XX000.*boom/] });
  await P.context().close();
}

// ---------------------------------------------------------------- Gesamtlauf
export default async function zugangE2e({ browser, base }) {
  const live = await zugangLive();
  const ids = fixtureIds();
  const G = ids.group;
  const code = await inviteCode();
  if (!code) throw new Error('Fixture-Code nicht lesbar');

  await anonPart({ browser, base });

  // ---------------------------------------------------------------- Krit 5: B ohne Gruppe
  const B = await page(browser, 'ZB');
  const ovB = { superadmin: false };
  await profileMock(B, ids.b, ovB);
  await section('Krit 5 Willkommen ohne Gruppe', [B], async () => {
    await B.goto(base);
    await waitHash(B, '#/login');
    await login(B, 'b');
    await waitHash(B, '#/willkommen');
    await B.waitForSelector('[data-act="code"]');
    const txt = await B.evaluate(() => document.body.innerText);
    ok('K5 B sieht den Einladungs-Hinweis und „Code eingeben“', txt.includes(de.welcome.sub) && (await B.locator('[data-act="code"]').count()) === 1);
    ok('K5 B sieht kein „Gruppe erstellen“', (await B.locator('[data-act="new"]').count()) === 0);
    await screens(B, 'willkommen');
    ovB.superadmin = true;
    await B.reload();
    await B.waitForSelector('[data-act="code"]');
    await B.waitForTimeout(200);
    ok('K5 mit abgefangenem is_superadmin ⇒ „Gruppe erstellen“ da', (await B.locator('[data-act="new"]').count()) === 1);
    ovB.superadmin = false;
  });
  await B.context().close();

  // ---------------------------------------------------------------- Krit 4: Beitritt mit bestehendem Konto
  const J = await page(browser, 'ZJ');
  const bodiesJ = [];
  const countB = async () => (await get('a', `members?select=id&playgroup_id=eq.${G}&profile_id=eq.${ids.b}`)).length;
  const k4 = await section('Krit 4 Bestehendes Konto tritt bei', [J], async () => {
    await J.goto(base + `#/beitreten/${code}`);
    await J.waitForSelector('[data-act="have-account"]');
    const st = await J.evaluate(() => document.querySelector('[data-state]')?.dataset.state);
    ok('K4 Fixture-Link abgemeldet ⇒ Einladung mit „Ich habe schon ein Konto“', st === 'invite', st);
    if (live) ok('K4 Einladung nennt die Fixture-Gruppe', (await J.evaluate(() => document.body.innerText)).includes(FIXTURE_NAME));
    await J.click('[data-act="have-account"]');
    await waitHash(J, '#/login');
    await login(J, 'b');
    await waitHash(J, '#/start');
    ok('K4 nach der Anmeldung: B in der Fixture (1 Mitgliedschaft), landet auf /start', (await countB()) === 1);
    await J.goto(base + `#/beitreten/${code}`);
    await J.waitForFunction(() => !location.hash.startsWith('#/beitreten'), null, { timeout: 15000 }).catch(() => {});
    await J.waitForTimeout(300);
    ok('K4 zweiter Aufruf des Links ⇒ keine zweite Mitgliedschaft (API-Zählung)', (await countB()) === 1);
  });
  if (!k4) await ensureMember('b');

  const C = await page(browser, 'ZC');
  await section('Krit 4 C übernimmt Platzhalter', [C], async () => {
    const ph0 = await ensurePlaceholder('Claim P9b');
    const [ph] = await get('a', `members?select=id,claim_code,profile_id&id=eq.${ph0.id}`);
    await C.goto(base);
    await waitHash(C, '#/login');
    await login(C, 'c');
    await waitHash(C, '#/willkommen');
    await C.goto(base + `#/code/${ph.claim_code}`);
    await waitHash(C, '#/start');
    const [after] = await get('a', `members?select=profile_id&id=eq.${ph.id}`);
    ok('K4 C übernimmt den Platzhalter über #/code/<claim> (profile_id = C)', after?.profile_id === ids.c);
  });
  await C.context().close();

  // ---------------------------------------------------------------- Krit 6: Karte für Mitglied B
  await section('Krit 6 Mitglied B', [J], async () => {
    J.on('response', async (r) => { if (r.url().startsWith(SB)) { try { bodiesJ.push(await r.text()); } catch { /* Umleitung o. ä. */ } } });
    await fresh(J, base, '#/gruppen');
    await J.waitForSelector('[data-invite-none]');
    ok('K6 Mitglied B sieht keine Einladungs-Karte, aber den Hinweis-Satz',
      (await J.locator('[data-invite]').count()) === 0 && (await J.textContent('[data-invite-none]')).includes(de.groups.inviteAdminsOnly));
    if (live) ok('K6 Code der Fixture steht nicht im Netzprotokoll von B', !bodiesJ.some((b) => b.includes(code)));
    else skip('K6 Code nicht im Netzprotokoll von B', 'Migration nicht in Prod (playgroups.invite_code für Mitglieder noch lesbar) — Dirigent nach db push');
  });

  // ---------------------------------------------------------------- Krit 6/7/8/9: A
  const A = await page(browser, 'ZA', { allowRenew: live });
  const ovA = { superadmin: false };
  await profileMock(A, ids.a, ovA);
  await A.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
  });
  const decoder = await (await browser.newContext()).newPage();
  let shared = null;
  const loggedA = await section('Krit 6 Einladungs-Karte (Admin A)', [A], async () => {
    await A.goto(base);
    await waitHash(A, '#/login');
    await login(A, 'a');
    await waitHash(A, '#/start');
    await A.goto(base + '#/gruppen');
    await A.waitForSelector('[data-invite] .code');
    ok('K6 A sieht den Code', (await A.textContent('[data-invite] .code')).trim() === code);
    for (const [act, label] of [['copy', 'Kopieren'], ['share', 'Link teilen'], ['qr', 'QR-Code'], ['renew', 'Link erneuern']]) {
      ok(`K6 A sieht „${label}“`, (await A.locator(`[data-invite] [data-act="${act}"]`).count()) === 1);
    }
    ok('K6 A sieht kein „Neue Gruppe“', (await A.locator('[data-act="new"]').count()) === 0);
    await A.click('[data-act="copy"]');
    await A.waitForFunction(() => window.__copied);
    ok('K6 Kopieren ⇒ Code', (await A.evaluate(() => window.__copied)) === code);
    await A.evaluate(() => { window.__copied = null; });
    await A.click('[data-act="share"]');
    await A.waitForFunction(() => window.__copied);
    shared = await A.evaluate(() => window.__copied);
    ok('K6 „Link teilen“ (ohne Web Share ⇒ Kopieren) endet auf #/beitreten/<code>', shared.endsWith(`#/beitreten/${code}`) && shared.startsWith(new URL(base).origin), shared);
    await A.waitForTimeout(200);
    await screens(A, 'einladungskarte');
  });

  await section('Krit 7b QR im Sheet', [A], async () => {
    if (!loggedA) throw new Error('A nicht angemeldet');
    await A.click('[data-invite] [data-act="qr"]');
    await A.waitForSelector('.sheet [data-qr] svg');
    const box = await A.locator('.sheet [data-qr] svg').boundingBox();
    ok('K7 QR ≥ 240 px Kantenlänge', box && box.width >= 240 && box.height >= 240, JSON.stringify(box));
    ok('K7 Sheet zeigt Gruppenname und Code', (await A.textContent('.sheet')).includes(FIXTURE_NAME) && (await A.textContent('.sheet .qr-code')).includes(code));
    const bgs = new Set();
    for (const l of LOOKS) {
      await setLook(A, l);
      await A.waitForTimeout(120);
      bgs.add(await A.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
      const buf = await A.locator('.sheet [data-qr]').screenshot({ animations: 'disabled' });
      const got = await decodePng(decoder, buf);
      ok(`K7b QR aus den Bildpunkten gelesen (${l}) = Link aus „Link teilen“`, got !== null && got === shared, String(got));
    }
    ok('K7b drei verschiedene Looks angewandt (--bg)', bgs.size === 3, JSON.stringify([...bgs]));
    await setLook(A, 'nacht');
    await screens(A, 'qr-sheet');
    await A.keyboard.press('Escape');
    await A.waitForSelector('.sheet', { state: 'detached' });
  });

  await section('Krit 8 Rollen-Knopf', [A], async () => {
    if (!loggedA) throw new Error('A nicht angemeldet');
    const [mb] = await get('a', `members?select=id,role&playgroup_id=eq.${G}&profile_id=eq.${ids.b}`);
    if (!mb) throw new Error('B ist nicht in der Fixture');
    await A.goto(base + `#/profil/${mb.id}`);
    await A.waitForSelector('.prof-head');
    await A.waitForTimeout(300);
    ok('K8 A (Admin, kein Superadmin) sieht auf B kein „Zum Admin machen“', (await A.locator('[data-act="role"]').count()) === 0);
    const roleCalls = [];
    await A.route(`${SB}/rest/v1/rpc/set_member_role*`, (r) => { roleCalls.push(r.request().postDataJSON()); return r.fulfill(json(200, null)); });
    ovA.superadmin = true;
    await A.reload();
    await A.waitForSelector('[data-act="role"]');
    ok('K8 mit abgefangenem is_superadmin ⇒ „Zum Admin machen“', (await A.textContent('[data-act="role"]')).includes(de.profile.makeAdmin));
    await A.click('[data-act="role"]');
    for (let i = 0; i < 30 && roleCalls.length === 0; i++) await A.waitForTimeout(100);
    ok('K8 Klick ruft set_member_role mit p_role: admin (abgefangen, nicht an Prod)', roleCalls.length === 1 && roleCalls[0].p_role === 'admin' && roleCalls[0].p_member === mb.id, JSON.stringify(roleCalls));
    ovA.superadmin = false;
    await A.unroute(`${SB}/rest/v1/rpc/set_member_role*`);
    const [mb2] = await get('a', `members?select=role&id=eq.${mb.id}`);
    ok('K8 B bleibt in Prod Mitglied (kein echter Rollenwechsel)', mb2?.role === 'member', mb2?.role);
  });

  await section('Krit 9 Verwaltung', [A], async () => {
    if (!loggedA) throw new Error('A nicht angemeldet');
    ovA.superadmin = false;
    await fresh(A, base, '#/einstellungen/verwaltung');
    await A.waitForFunction(() => location.hash === '#/einstellungen', null, { timeout: 15000 });
    await A.waitForSelector('[data-nav="account"]');
    ok('K9 A ⇒ #/einstellungen/verwaltung leitet auf /einstellungen um, keine Zeile „Verwaltung“', (await A.locator('[data-nav="admin"]').count()) === 0);

    let ov = { accounts: 14, unconfirmed: 2, max_accounts: 20 };
    const maxCalls = [];
    let maxRes = json(200, null);
    await A.route(`${SB}/rest/v1/rpc/access_overview*`, (r) => r.fulfill(json(200, ov)));
    await A.route(`${SB}/rest/v1/rpc/set_max_accounts*`, (r) => { maxCalls.push(r.request().postDataJSON()); return r.fulfill(maxRes); });
    ovA.superadmin = true;
    await fresh(A, base, '#/einstellungen');
    await A.waitForSelector('[data-nav="admin"]');
    ok('K9 mit is_superadmin ⇒ Zeile „Verwaltung“', (await A.textContent('[data-nav="admin"]')).includes(de.access.adminTitle));
    await A.click('[data-nav="admin"]');
    await waitHash(A, '#/einstellungen/verwaltung');
    await A.waitForSelector('[data-count]');
    ok('K9 „14 von 20 Konten“', (await A.textContent('[data-count]')).trim() === '14 von 20 Konten', await A.textContent('[data-count]'));
    ok('K9 „davon 2 noch nicht bestätigt“', (await A.textContent('[data-unconfirmed]')).trim() === 'davon 2 noch nicht bestätigt');
    ok('K9 kein Sperr-Hinweis bei 14/20', (await A.locator('[data-locked]').count()) === 0);
    await screens(A, 'verwaltung');

    const errOf = () => A.evaluate(() => { const e = document.querySelector('[data-form="max"] .error'); return e && !e.hidden ? e.textContent : null; });
    await A.fill('#ad-max', '25');
    await A.click('[data-form="max"] button[type=submit]');
    for (let i = 0; i < 50 && maxCalls.length === 0; i++) await A.waitForTimeout(100);
    ok('K9 Speichern mit 25 ⇒ set_max_accounts { p_max: 25 }', maxCalls.length === 1 && maxCalls[0].p_max === 25, JSON.stringify(maxCalls));
    await A.waitForTimeout(400);
    await A.waitForSelector('#ad-max');
    for (const bad of ['0', '1001']) {
      await A.fill('#ad-max', bad);
      await A.click('[data-form="max"] button[type=submit]');
      await A.waitForTimeout(250);
      ok(`K9 ${bad} ⇒ Feldfehler ohne Aufruf`, maxCalls.length === 1 && (await errOf()) === de.auth.errors.max_accounts_range, String(await errOf()));
    }
    maxRes = json(400, { code: 'P0001', message: 'max_accounts_range', details: null, hint: null });
    await A.fill('#ad-max', '30');
    await A.click('[data-form="max"] button[type=submit]');
    for (let i = 0; i < 50 && maxCalls.length < 2; i++) await A.waitForTimeout(100);
    await A.waitForTimeout(200);
    ok('K9 Antwort max_accounts_range ⇒ übersetzte Meldung (Aufruf erfolgt)', maxCalls.length === 2 && (await errOf()) === de.auth.errors.max_accounts_range, String(await errOf()));

    ov = { accounts: 20, unconfirmed: 0, max_accounts: 20 };
    await A.reload();
    await A.waitForSelector('[data-count]');
    ok('K9 20/20 ⇒ Sperr-Hinweis', (await A.locator('[data-locked]').count()) === 1 && (await A.textContent('[data-locked]')).includes(de.access.locked));
    ovA.superadmin = false;
    await A.unroute(`${SB}/rest/v1/rpc/access_overview*`);
    await A.unroute(`${SB}/rest/v1/rpc/set_max_accounts*`);
  });

  // ---------------------------------------------------------------- Krit 13: Tor-Fälle (nur nach dem db push)
  const TOR = [
    'K13 signUp über die API ohne Code ⇒ „Database error saving new user“, keine Sitzung',
    'K13 signUp über die API mit falschem Code ⇒ „Database error saving new user“, keine Sitzung',
    'K13 signInAnonymously() ⇒ Fehler',
    'K13 B liest playgroup_invites ⇒ 0 Zeilen, A ⇒ 1 Zeile',
    'K13 A create_playgroup ⇒ superadmin_only',
    "K13 A set_member_role(B, 'admin') ⇒ superadmin_only",
    'K13 check_invite ohne Sitzung: Fixture-Code ⇒ ok + TTG-E2E-Fixture, Tippfehler ⇒ invalid',
    '„Link erneuern“ als A ⇒ neuer Code, alter Link zeigt „kennen wir nicht (mehr)“',
  ];
  if (!live) {
    for (const n of TOR) skip(n.startsWith('K13') ? n : `K13 ${n}`, 'Migration nicht in Prod (zugangLive=false) — Dirigent nach db push');
  } else {
    await section('Krit 13 Tor-Fälle', [A], async () => {
      const raw = async (body) => {
        const r = await fetch(`${SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: TARGET.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
        let d = {}; try { d = await r.json(); } catch { /* leer */ }
        return { status: r.status, msg: String(d.msg || d.message || d.error_description || ''), session: !!d.access_token };
      };
      const gate = (x) => x.status >= 400 && /Database error saving new user/i.test(x.msg) && !x.session;
      let x = await raw({ email: plus('p9btor1'), password: `${password()}x`, data: { display_name: 'Tor' } });
      ok(TOR[0], gate(x), `${x.status} ${x.msg.slice(0, 80)}`);
      x = await raw({ email: plus('p9btor2'), password: `${password()}x`, data: { display_name: 'Tor', invite_code: 'TTG-FALSCH' } });
      ok(TOR[1], gate(x), `${x.status} ${x.msg.slice(0, 80)}`);
      x = await raw({ data: {} });
      ok(TOR[2], x.status >= 400 && !x.session, String(x.status));
      const rb = await get('b', `playgroup_invites?select=code&playgroup_id=eq.${G}`);
      const ra = await get('a', `playgroup_invites?select=code&playgroup_id=eq.${G}`);
      ok(TOR[3], rb.length === 0 && ra.length === 1, `${rb.length}/${ra.length}`);
      const rpcErr = async (fn, args) => { try { await rpc('a', fn, args); return 'kein Fehler'; } catch (e) { return String(e.body?.message ?? e.message); } };
      const e1 = await rpcErr('create_playgroup', { p_name: 'E2E Tor' });
      ok(TOR[4], e1 === 'superadmin_only', e1);
      const [mb] = await get('a', `members?select=id&playgroup_id=eq.${G}&profile_id=eq.${ids.b}`);
      const e2 = mb ? await rpcErr('set_member_role', { p_member: mb.id, p_role: 'admin' }) : 'B fehlt';
      ok(TOR[5], e2 === 'superadmin_only', e2);
      const anon = async (c) => (await fetch(`${SB}/rest/v1/rpc/check_invite`, { method: 'POST', headers: { apikey: TARGET.key, Authorization: `Bearer ${TARGET.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: c }), signal: AbortSignal.timeout(20000) })).json();
      const c1 = await anon(code);
      const c2 = await anon(code.slice(0, -1) + (code.endsWith('Z') ? 'Y' : 'Z'));
      ok(TOR[6], c1?.status === 'ok' && c1?.group_name === FIXTURE_NAME && c2?.status === 'invalid', JSON.stringify([c1?.status, c2?.status]));

      await A.goto(base + '#/gruppen');
      await A.waitForSelector('[data-invite] [data-act="renew"]');
      await A.click('[data-invite] [data-act="renew"]');
      await A.click('.sheet [data-act="renew-yes"]');
      await A.waitForFunction((old) => { const e = document.querySelector('[data-invite] .code'); return e && e.textContent.trim() !== old; }, code, { timeout: 15000 });
      const neu = (await A.textContent('[data-invite] .code')).trim();
      const P2 = await page(browser, 'ZP2');
      await P2.goto(base + `#/beitreten/${code}`);
      await P2.waitForSelector('[data-state]');
      ok(`K13 ${TOR[7]}`, neu !== code && (await P2.evaluate(() => document.body.innerText)).includes(de.access.invalid));
      footer([['ZP2', P2]]);
      await P2.context().close();
    });
  }
  skip('Echte Registrierung über das Formular (Wegwerf-Konto)', 'TTG_E2E_SIGNUP nicht gesetzt (Standard; Einschalten ist Sache des Dirigenten)');

  footer([['ZJ', J], ['ZA', A]], { ZA: [`400 ${SB}/rest/v1/rpc/set_max_accounts`] });
  await decoder.context().close();
  for (const p of [J, A]) await p.context().close();
}
