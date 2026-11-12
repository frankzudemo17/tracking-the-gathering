// E2E Seitenwechsel (Spec P12, S1–S5; S6 hängt an spiel-ende.e2e.mjs) unter dem P9b-Harness:
// feste Konten A und B, nur TTG-E2E-Fixture, nichts wird geschrieben. Ausgegeben werden nur Wahrheitswerte und
// Zeiten — nie eine Adresse, eine Konto-ID oder ein Schlüssel des Zwischenspeichers.
import { ok, ctx, waitHash, login, prepare, TARGET } from './harness.mjs';

/** Schlüssel des Zwischenspeichers und die aktuelle Konto-/Gruppen-Kennung, nur im Browser verglichen. */
const keysCheck = (p) => p.evaluate(async () => {
  const c = (await import(new URL('src/lib/cache.js', location.href).href)).pageCache;
  const { state } = await import(new URL('src/state.js', location.href).href);
  const keys = c.keys();
  const prefix = state.session?.user?.id && state.groupId ? `${state.session.user.id}|${state.groupId}|` : null;
  return { n: keys.length, all: !!prefix && keys.every((k) => k.startsWith(prefix)) };
});

/** Tipp auf einen Tab im Browser; misst bis zum ersten Bild mit der Marke und beobachtet `.loading` in #view. */
const tapAndTime = (p, href, mark) => p.evaluate(([h, m]) => new Promise((res) => {
  let sawLoading = !!document.querySelector('#view .loading');
  const mo = new MutationObserver(() => { if (document.querySelector('#view .loading')) sawLoading = true; });
  mo.observe(document.body, { childList: true, subtree: true });
  const t0 = performance.now();
  let ms = -1;
  document.querySelector(`nav.nav a[href="${h}"]`).click();
  const tick = () => {
    if (ms < 0 && document.querySelector(m)) ms = Math.round(performance.now() - t0);
    // nach der Marke noch 2 s weiter beobachten: die verzögerten Antworten (1,5 s) dürfen keinen Lade-Kreis bringen
    if (performance.now() - t0 > (ms < 0 ? 8000 : ms + 2000)) { mo.disconnect(); res({ ms, sawLoading }); } else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), [href, mark]);

export default async function seitenwechselE2e({ browser, base: BASE }) {
  await prepare({ members: ['b'] });

  console.log('\nSeitenwechsel: Start steht → Rangliste → Start mit verzögerten Antworten');
  const P = await ctx(browser, 'SW');
  await P.goto(BASE);
  await waitHash(P, '#/login');
  await login(P, 'a');
  await waitHash(P, '#/start');
  await P.waitForSelector('#view .people .person', { timeout: 20000 });
  await P.waitForFunction(() => !document.querySelector('#view[aria-busy="true"]'), null, { timeout: 20000 }).catch(() => {});
  await P.evaluate(() => { window.__swNav = document.querySelector('nav.nav'); window.__swNoReload = 1; });
  await P.click('nav.nav a[href="#/rangliste"]');
  await waitHash(P, '#/rangliste');
  await P.waitForSelector('#view .brd-body > *', { timeout: 20000 });

  // S1: REST-Antworten um 1500 ms verzögert, unverändert weitergereicht
  const slow = async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue().catch(() => {}); };
  await P.context().route(`${TARGET.url}/rest/v1/**`, slow);
  const s1 = await tapAndTime(P, '#/start', '#view .people .person');
  await P.context().unroute(`${TARGET.url}/rest/v1/**`, slow);
  console.log(`    Start nach Rangliste: ${s1.ms} ms bis zur Leute-Leiste (Antworten 1500 ms verzögert)`);
  ok('S1 Leute-Leiste binnen 500 ms trotz verzögerter Antworten', s1.ms >= 0 && s1.ms <= 500, `${s1.ms} ms`);
  ok('S1 kein Lade-Kreis (.loading) in #view', !s1.sawLoading);

  // S2: die Leiste bleibt derselbe Knoten
  ok('S2 Navigationsleiste ist derselbe Knoten', await P.evaluate(() => window.__swNav === document.querySelector('nav.nav') && window.__swNoReload === 1));

  // S3: alle Schlüssel tragen Konto + Gruppe von A
  const k3 = await keysCheck(P);
  ok('S3 alle Speicher-Schlüssel beginnen mit Konto und Gruppe von A', k3.n > 0 && k3.all, `Anzahl ${k3.n}, alle passend: ${k3.all}`);
  await P.shot('p12-s3-start');

  // S4: Abmelden über die Einstellungen ⇒ Speicher leer
  await P.click('nav.nav a[href="#/profil"]');
  await waitHash(P, '#/profil');
  await P.click('a[href="#/einstellungen"]');
  await waitHash(P, '#/einstellungen');
  await P.click('[data-act="logout"]');
  await waitHash(P, '#/login');
  const k4 = await keysCheck(P);
  ok('S4 nach Abmelden: #/login und Speicher leer', k4.n === 0, `Anzahl ${k4.n}`);

  // S5: B meldet sich im selben Tab an
  await login(P, 'b');
  await waitHash(P, '#/start');
  await P.waitForSelector('#view .people .person', { timeout: 20000 });
  await P.waitForFunction(() => !document.querySelector('#view[aria-busy="true"]'), null, { timeout: 20000 }).catch(() => {});
  const k5 = await keysCheck(P);
  ok('S5 B im selben Tab: Start steht, alle Schlüssel beginnen mit Konto und Gruppe von B', k5.n > 0 && k5.all, `Anzahl ${k5.n}, alle passend: ${k5.all}`);
  await P.shot('p12-s5-start-b');

  ok('Keine JS-Fehler (Seitenwechsel)', P.errs.length === 0, P.errs.join(' | '));
  await P.context().close();
}
