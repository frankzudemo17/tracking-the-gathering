// E2E Kaltstart (Spec P6, K1–K6) unter dem P9b-Harness: feste Konten A und B, nur TTG-E2E-Fixture. Geschrieben wird
// nur A's Profilbild (K3); der Grundzustand des Runners räumt es davor/danach weg (fixture-api: Ordner auflisten).
// Ausgegeben werden nur Wahrheitswerte und Zahlen — nie eine Adresse, eine Konto-ID oder ein Schlüssel.
import { ok, ctx, waitHash, login, prepare, testImage, TARGET } from './harness.mjs';

/** Gerätespeicher im Browser lesen und mit dem angemeldeten Konto vergleichen (nur Zahlen/Wahrheitswerte). */
const storeCheck = (p) => p.evaluate(async () => {
  const ds = (await import(new URL('src/lib/device-store.js', location.href).href)).deviceStore;
  try { await ds.flush(); } catch { /* egal */ }
  const { state } = await import(new URL('src/state.js', location.href).href);
  const uid = state.session?.user?.id || null;
  const konto = localStorage.getItem('ttg.konto');
  const out = { daten: 0, bilder: 0, own: false, foreign: 0, konto: konto !== null, kontoOwn: !!uid && konto === uid };
  const dbs = indexedDB.databases ? await indexedDB.databases() : [];
  if (!dbs.some((d) => d.name === 'ttg-geraet')) return out;
  const db = await new Promise((res, rej) => { const q = indexedDB.open('ttg-geraet'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const all = (s) => new Promise((res) => { try { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); } catch { res([]); } });
  const d = await all('daten'); const b = await all('bilder');
  db.close();
  const mine = (r) => !!uid && typeof r.key === 'string' && r.key.startsWith(`${uid}|`) && r.account === uid;
  out.daten = d.length; out.bilder = b.length;
  out.own = d.length + b.length > 0 && [...d, ...b].every(mine);
  out.foreign = [...d, ...b].filter((r) => !mine(r)).length;
  return out;
});

/** Erstes Bild mit Inhalt in #view nach dem nächsten Laden (Init-Skript des Kontexts, je requestAnimationFrame). */
const FIRST_FRAME = () => {
  window.__k2 = null;
  const tick = () => {
    const v = document.querySelector('#view');
    if (v && v.children.length) {
      window.__k2 = {
        people: v.querySelectorAll('.people .person').length,
        skel: v.querySelectorAll('[data-skel]').length,
        loading: !!v.querySelector('.loading'),
        busy: v.getAttribute('aria-busy') === 'true',
        t: Math.round(performance.now()),
      };
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const settle = (p) => p.waitForFunction(() => !document.querySelector('#view[aria-busy="true"]'), null, { timeout: 20000 }).catch(() => {});

export default async function kaltstartE2e({ browser, base: BASE }) {
  await prepare({ members: ['b'] });
  const IMG = await testImage(browser);

  console.log('\nKaltstart: A angemeldet → Neuladen mit verzögerten Antworten → Profilbild → Abmelden → B');
  const P = await ctx(browser, 'KS');
  await P.goto(BASE);
  await waitHash(P, '#/login');

  // K1: A meldet sich an, Start steht, Rangliste und Historie besucht, Schreib-Warteschlange leer
  await login(P, 'a');
  await waitHash(P, '#/start');
  await P.waitForSelector('#view .people .person', { timeout: 20000 });
  await settle(P);
  await P.click('nav.nav a[href="#/rangliste"]');
  await waitHash(P, '#/rangliste');
  await P.waitForSelector('#view .brd-body > *', { timeout: 20000 });
  await P.click('nav.nav a[href="#/historie"]');
  await waitHash(P, '#/historie');
  await P.waitForSelector('#view .hist-list > *, #view .empty', { timeout: 20000 });
  await P.click('nav.nav a[href="#/start"]');
  await waitHash(P, '#/start');
  await settle(P);
  const k1 = await storeCheck(P);
  ok('K1 Gerätespeicher nach Start/Rangliste/Historie gefüllt, Marke = Konto A', k1.daten > 0 && k1.kontoOwn, `daten ${k1.daten}, Marke passend ${k1.kontoOwn}`);

  // K2: Neuladen, REST/RPC/Signieren um 1500 ms verzögert (unverändert weitergereicht)
  const slow = async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue().catch(() => {}); };
  const SLOW = [`${TARGET.url}/rest/v1/**`, `${TARGET.url}/storage/v1/object/sign/**`];
  for (const u of SLOW) await P.context().route(u, slow);
  await P.context().addInitScript(FIRST_FRAME);
  await P.reload({ waitUntil: 'domcontentloaded' });
  await P.waitForFunction(() => window.__k2, null, { timeout: 20000 }).catch(() => {});
  const k2 = await P.evaluate(() => window.__k2);
  for (const u of SLOW) await P.context().unroute(u, slow);
  console.log(`    erstes Bild nach dem Neuladen: ${k2 ? `${k2.t} ms, Leute ${k2.people}` : 'keins'} (Antworten 1500 ms verzögert)`);
  ok('K2 erstes Bild mit Inhalt: Leute-Leiste ≥ 1', !!k2 && k2.people >= 1, k2 ? `Leute ${k2.people}` : 'kein Bild');
  ok('K2 erstes Bild ohne Gerüst, ohne .loading, ohne aria-busy', !!k2 && k2.skel === 0 && !k2.loading && !k2.busy, k2 ? `Gerüst ${k2.skel}, loading ${k2.loading}, busy ${k2.busy}` : '');
  await settle(P);

  // K3: A setzt ein Profilbild; Neuladen ⇒ oben eine blob:-Adresse
  await P.click('nav.nav a[href="#/profil"]');
  await waitHash(P, '#/profil');
  await P.waitForSelector('[data-act="photo"]', { timeout: 20000 });
  await P.click('[data-act="photo"]');
  await P.setInputFiles('.sheet input[type=file]:not([capture])', IMG);
  await P.waitForSelector('.prof-head .avatar[style*="background-image"]', { timeout: 20000 });
  await P.click('nav.nav a[href="#/start"]');
  await waitHash(P, '#/start');
  await settle(P);
  await storeCheck(P); // Warteschlange leeren
  await P.reload({ waitUntil: 'domcontentloaded' });
  await P.waitForSelector('#view .people .person', { timeout: 20000 });
  const k3 = await P.waitForFunction(() => /blob:/.test(document.querySelector('.top .avatar')?.getAttribute('style') || ''), null, { timeout: 15000 }).then(() => true, () => false);
  ok('K3 nach Neuladen trägt .top .avatar eine blob:-Adresse', k3);

  // K4: alle Datensätze gehören A
  await settle(P);
  const k4 = await storeCheck(P);
  ok('K4 alle Datensätze beginnen mit der Konto-ID von A', k4.own && k4.foreign === 0, `daten ${k4.daten}, bilder ${k4.bilder}, fremd ${k4.foreign}`);

  // K5: Abmelden über die Einstellungen ⇒ #/login, Gerätespeicher leer, ttg.konto fehlt
  await P.click('nav.nav a[href="#/profil"]');
  await waitHash(P, '#/profil');
  await P.click('a[href="#/einstellungen"]');
  await waitHash(P, '#/einstellungen');
  await P.click('[data-act="logout"]');
  await waitHash(P, '#/login');
  const k5 = await storeCheck(P);
  ok('K5 nach Abmelden: #/login, Gerätespeicher leer, ttg.konto fehlt', k5.daten === 0 && k5.bilder === 0 && !k5.konto, `daten ${k5.daten}, bilder ${k5.bilder}, Marke ${k5.konto}`);

  // K6: B meldet sich im selben Kontext an ⇒ nur Datensätze von B; A's Bild lädt B über die signierte Adresse (CORS)
  await login(P, 'b');
  await waitHash(P, '#/start');
  await P.waitForSelector('#view .people .person', { timeout: 20000 });
  await settle(P);
  let k6 = await storeCheck(P);
  for (let i = 0; i < 20 && k6.bilder === 0; i++) { await P.waitForTimeout(500); k6 = await storeCheck(P); }
  ok('K6 B im selben Kontext: Start steht, alle Datensätze mit Konto-ID von B, keiner von A', k6.own && k6.foreign === 0 && k6.kontoOwn, `daten ${k6.daten}, bilder ${k6.bilder}, fremd ${k6.foreign}`);
  ok('K6 Profilbild von A bei B lokal abgelegt (Download mit CORS gegen echtes Supabase)', k6.bilder >= 1, `bilder ${k6.bilder}`);
  await P.shot('p6-k6-start-b');

  ok('Keine JS-Fehler (Kaltstart)', P.errs.length === 0, P.errs.join(' | '));
  await P.context().close();
}
