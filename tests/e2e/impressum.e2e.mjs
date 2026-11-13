// P10 Impressum nur für Angemeldete (spec-p10-impressum.md Krit. 17): abgemeldet neutral + Hinweis ohne Anfrage an
// app_info; angemeldet (Fixture-Konto A) je nach Prod-Stand:
//   Tabelle fehlt (vor dem db push)  ⇒ Wert-Fälle sichtbar übersprungen, Seite neutral, 0 JS-Fehler; der 404 auf genau
//                                      /rest/v1/app_info zählt dann als Übergang (harness env.appInfoMissing), sonst nichts
//   Tabelle + Zeile impressum da     ⇒ Abschnitt ≠ neutraler Satz und Länge ≥ 10, nirgends gespeichert, nach Abmelden weg
// Die Ausgabe nennt nur Wahrheitswerte und Längen, nie den Text. Die Probe fragt per REST nur die Spalte key ab.
// Die angemeldete Seite wird am Ende geschlossen und aus der Fehlerbild-Liste genommen (kein Bild mit echten Angaben).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ok, skip, ctx, waitHash, login, signIn, api, rest, Abort, env, opened, ROOT } from './harness.mjs';

const de = (await import(pathToFileURL(path.join(ROOT, 'src', 'i18n', 'de.js')).href)).default;
const SKIP = 'Migration nicht in Prod';

/** Stand in Prod, als Konto A: { table, row } — nur die Spalte key wird gelesen. */
async function appInfoState() {
  const s = await signIn('a');
  try {
    const rows = await api('GET', rest('app_info?select=key&key=eq.impressum'), { token: s.token });
    return { table: true, row: Array.isArray(rows) && rows.length === 1 };
  } catch (e) {
    if (e instanceof Abort) throw e;
    if (e.status === 404 && (e.code === 'PGRST205' || e.code === '42P01')) return { table: false, row: false };
    throw new Abort('Impressum-Probe', `app_info antwortet unerwartet: Status ${e.status}, Code ${e.code}`);
  }
}

/** Hash setzen, warten bis der Abschnitt gezeichnet und befüllt ist; liefert nur Wahrheitswerte/Längen. */
async function visit(P, hash) {
  await P.evaluate((h) => { location.hash = h; }, hash);
  await P.waitForFunction((h) => location.hash === h && !!document.querySelector('#view [data-imprint]'), hash, { timeout: 15000 });
  await P.waitForFunction(() => !document.querySelector('#view [data-imprint]')?.hasAttribute('aria-busy'), null, { timeout: 15000 });
  await P.waitForTimeout(300);
  return P.evaluate((op) => {
    const sec = document.querySelector('#view [data-imprint]');
    const v = sec.querySelector('[data-imprint-value]');
    const text = (v?.textContent ?? '').trim();
    return {
      operator: sec.querySelector('[data-operator]')?.textContent === op,
      hint: !!sec.querySelector('[data-members-only]'),
      value: !!v, valueLen: text.length, valueIsOperator: text === op,
    };
  }, de.legal.operator);
}

/** Sucht `needle` (nur in der Seite bekannt) in localStorage, sessionStorage, allen IndexedDB-Stores und CacheStorage. */
const stored = (P, needleExpr) => P.evaluate(async (expr) => {
  // eslint-disable-next-line no-new-func
  const n = new Function(`return (${expr})`)();
  const out = { local: false, session: false, idb: false, caches: false, cacheApi: typeof caches !== 'undefined', restInCache: false };
  if (!n) return out;
  const has = (x) => { try { return JSON.stringify(x).includes(n) || String(x).includes(n); } catch { return String(x).includes(n); } };
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (has(k) || has(localStorage.getItem(k))) out.local = true; }
  for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (has(k) || has(sessionStorage.getItem(k))) out.session = true; }
  for (const { name } of (indexedDB.databases ? await indexedDB.databases() : [])) {
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const s of db.objectStoreNames) {
      const vals = await new Promise((res, rej) => { const tx = db.transaction(s, 'readonly'); const q = tx.objectStore(s).getAll(); tx.oncomplete = () => res(q.result); tx.onerror = () => rej(tx.error); });
      if (has(vals)) out.idb = true;
    }
    db.close();
  }
  if (out.cacheApi) {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const req of await c.keys()) {
        if (/\/rest\/v1\//.test(req.url)) out.restInCache = true;
        const res = await c.match(req);
        if (res && (await res.clone().text()).includes(n)) out.caches = true;
      }
    }
  }
  return out;
}, needleExpr);

export default async function impressumE2e({ browser, base: BASE }) {
  const st = await appInfoState();
  console.log(`\nImpressum: Tabelle app_info in Prod: ${st.table ? 'ja' : 'nein (Wert-Fälle werden übersprungen)'} · Zeile impressum: ${st.row ? 'ja' : 'nein'}`);

  // ---------------------------------------------------------------- abgemeldet
  const O = await ctx(browser, 'IM-ab');
  let oCalls = 0;
  O.on('request', (r) => { if (/\/rest\/v1\/app_info(\?|$)/.test(r.url())) oCalls++; });
  await O.goto(BASE);
  await waitHash(O, '#/login');
  for (const h of ['#/datenschutz', '#/einstellungen/rechtliches']) {
    const s = await visit(O, h);
    ok(`abgemeldet ${h}: neutraler Satz + Hinweis, kein Wert`, s.operator && s.hint && !s.value, JSON.stringify(s));
  }
  ok('abgemeldet: 0 Anfragen an /rest/v1/app_info', oCalls === 0, `${oCalls}`);
  ok('abgemeldet: keine JS-Fehler, keine HTTP-Fehler', O.errs.length === 0 && O.bad.length === 0, [...O.errs, ...O.bad].join(' | '));
  await O.context().close();

  // ---------------------------------------------------------------- angemeldet (Konto A)
  env.appInfoMissing = !st.table;
  const A = await ctx(browser, 'IM-a');
  let aCalls = 0;
  A.on('request', (r) => { if (/\/rest\/v1\/app_info(\?|$)/.test(r.url())) aCalls++; });
  try {
    await A.goto(BASE);
    await waitHash(A, '#/login');
    await login(A, 'a');
    await waitHash(A, '#/start');
    const c0 = aCalls;
    const sP = await visit(A, '#/datenschutz');
    ok('angemeldet #/datenschutz: genau 1 Anfrage an app_info', aCalls - c0 === 1, `${aCalls - c0}`);
    ok('angemeldet #/datenschutz: kein Hinweis „nur für Angemeldete“', !sP.hint);
    const c1 = aCalls;
    const sL = await visit(A, '#/einstellungen/rechtliches');
    ok('angemeldet #/einstellungen/rechtliches: genau 1 Anfrage an app_info, kein Hinweis', aCalls - c1 === 1 && !sL.hint, `${aCalls - c1}`);

    if (!st.table) {
      ok('Tabelle fehlt: beide Seiten neutral (Satz ohne Hinweis, kein Wert)', sP.operator && !sP.value && sL.operator && !sL.value);
      ok('Tabelle fehlt: 404 auf /rest/v1/app_info als Übergang erkannt', A.transit.some((u) => u.endsWith('/rest/v1/app_info')), `${A.transit.length}`);
      skip('Wert im Abschnitt (≠ neutraler Satz, Länge ≥ 10)', SKIP);
      skip('Wert nirgends gespeichert / nach Abmelden weg', SKIP);
    } else if (!st.row) {
      ok('Tabelle da, Zeile fehlt: beide Seiten neutral (Satz ohne Hinweis, kein Wert)', sP.operator && !sP.value && sL.operator && !sL.value);
      skip('Wert im Abschnitt (≠ neutraler Satz, Länge ≥ 10)', 'Zeile impressum noch nicht eingetragen');
      skip('Wert nirgends gespeichert / nach Abmelden weg', 'Zeile impressum noch nicht eingetragen');
    } else {
      ok('Wert im Abschnitt (beide Seiten): ≠ neutraler Satz, Länge ≥ 10', sP.value && !sP.valueIsOperator && sP.valueLen >= 10 && sL.value && !sL.valueIsOperator && sL.valueLen >= 10,
        `Längen ${sP.valueLen}/${sL.valueLen}`);
      // Wert nur in der Seite festhalten (für Speicher- und Abmelde-Prüfung), nie nach außen
      await A.evaluate(() => { /** @type {any} */ (window).__imp = document.querySelector('#view [data-imprint-value]')?.textContent?.trim() || ''; });
      await A.waitForTimeout(1500);
      const s = await stored(A, 'window.__imp');
      ok('Wert nicht in localStorage/sessionStorage/IndexedDB/CacheStorage', !s.local && !s.session && !s.idb && !s.caches, JSON.stringify(s));
      await A.evaluate(() => { location.hash = '#/einstellungen'; });
      await waitHash(A, '#/einstellungen');
      await A.click('[data-act="logout"]');
      await waitHash(A, '#/login');
      const after = await visit(A, '#/datenschutz');
      const gone = await A.evaluate(() => { const w = /** @type {any} */ (window); const n = w.__imp; delete w.__imp; return !!n && !document.body.innerText.includes(n) && !document.body.innerHTML.includes(n); });
      ok('nach Abmelden: #/datenschutz neutral + Hinweis, Wert nicht im DOM', after.operator && after.hint && !after.value && gone);
    }
    // Service Worker: keine Supabase-REST-Antwort im CacheStorage (unabhängig vom Prod-Stand)
    const c = await stored(A, "'/rest/v1/'");
    ok('CacheStorage enthält keine /rest/v1/-Antwort', c.cacheApi ? !c.restInCache : true, c.cacheApi ? '' : 'CacheStorage nicht verfügbar');
    ok('angemeldet: keine JS-Fehler, keine HTTP-Fehler', A.errs.length === 0 && A.bad.length === 0, [...A.errs, ...A.bad].join(' | '));
  } finally {
    env.appInfoMissing = false;
    // kein Fehlerbild einer Seite mit echten Anbieterangaben
    const i = opened.findIndex(([, p]) => p === A);
    if (i >= 0) opened.splice(i, 1);
    await A.context().close().catch(() => {});
  }
}
