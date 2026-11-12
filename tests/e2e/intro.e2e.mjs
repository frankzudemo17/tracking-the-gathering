// E2E Spielstart-Intro (Spec P3, Welle ttg-features, Kriterium 29) unter dem P9b-Harness: feste Konten A/B/C,
// nur TTG-E2E-Fixture, Grundzustand davor und danach (run.mjs). Der Harness schaltet das Intro für alle anderen
// Dateien aus (ctx(): startIntro false, wenn der Schlüssel fehlt); diese Datei schaltet es gezielt ein.
// Spiel 1 startet über #/spiel-neu (wie am Tisch), Spiel 2 und 3 über den Store der App (gleiche Modul-Instanz,
// gleicher Merker „frisch gestartet“). Jedes gestartete Spiel wird verworfen.
// Motto-Fälle hängen an mottoLive() (Spalte decks.motto in Prod?); vorher sichtbar übersprungen, dafür läuft der
// Übergangsfall „Deckprofil ohne Spalte: kein Motto-Feld, keine Antwort ≥ 400“.
// P8 (Intro 2.0): Bühne „Tisch“ mit ganzer Karte; Start über #/spiel-neu lädt die normal-Adresse vor; Liegezeit aus
// der Gruppe. Einstellungs-Fälle hängen an introSecondsLive() (Spalte playgroups.intro_seconds in Prod?); vorher
// sichtbar übersprungen, dafür Übergangsfall: keine Intro-Karte auf #/gruppen, Liegezeit 4 s.
import { ok, skip, ctx, waitHash, login, prepare, Abort, signIn, api, rest, get, rpc, fixtureIds } from './harness.mjs';
import { normalFromArt } from '../../src/lib/card-images.js';

const MOTTO = 'E2E: Kein Zug ohne Plan';

let mLive = null;
/** Gibt es decks.motto in der Ziel-Datenbank (P3-Migration in Prod)? Einmal je Lauf, als Konto A (Muster mitgliederLive). */
async function mottoLive() {
  if (mLive !== null) return mLive;
  const s = await signIn('a');
  try {
    await api('GET', rest('decks?select=motto&limit=1'), { token: s.token });
    mLive = true;
  } catch (e) {
    if (e instanceof Abort) throw e;
    if (e.status === 400 && (e.code === '42703' || e.code === 'PGRST204')) mLive = false;
    else throw new Abort('Motto-Probe', `decks?select=motto antwortet unerwartet: ${e.message}`);
  }
  return mLive;
}

let sLive = null;
/** Gibt es playgroups.intro_seconds in der Ziel-Datenbank (P8-Migration in Prod)? Einmal je Lauf, als Konto A (Muster mottoLive). */
async function introSecondsLive() {
  if (sLive !== null) return sLive;
  const s = await signIn('a');
  try {
    await api('GET', rest('playgroups?select=intro_seconds&limit=1'), { token: s.token });
    sLive = true;
  } catch (e) {
    if (e instanceof Abort) throw e;
    if (e.status === 400 && (e.code === '42703' || e.code === 'PGRST204')) sLive = false;
    else throw new Abort('Intro-Dauer-Probe', `playgroups?select=intro_seconds antwortet unerwartet: ${e.message}`);
  }
  return sLive;
}

export default async function introE2e({ browser, base: BASE }) {
  const { decks } = await prepare({ members: ['b', 'c'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  const tymna = decks['a:tymna'], krenko = decks['b:krenko'];
  const live = await mottoLive();
  console.log(`\nIntro: Motto-Spalte in Prod: ${live ? 'ja' : 'nein (Motto-Fälle werden übersprungen)'}`);
  const secLive = await introSecondsLive();
  console.log(`Intro: Spalte intro_seconds in Prod: ${secLive ? 'ja' : 'nein (Einstellungs-Fälle werden übersprungen)'}`);
  const fx = fixtureIds();

  const A = await ctx(browser, 'IA');
  await A.goto(BASE);
  await waitHash(A, '#/login');
  await login(A, 'a');
  await waitHash(A, '#/start');

  const db = (fn, arg) => A.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    const { createStore } = await import('/src/lib/game-store.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'createStore', 'a', `return (async () => { ${src} })()`)(sb, state, createStore, a);
  }, [fn, arg]);
  const pref = (key, value) => A.evaluate(async ([k, v]) => (await import('/src/lib/prefs.js')).setPref(k, v), [key, value]);
  const stored = () => A.evaluate(() => { try { return JSON.parse(localStorage.getItem('ttg.prefs.v1')); } catch { return null; } });
  const go = (h) => A.evaluate((x) => { location.hash = x; }, h);
  const field = (id) => `.lc-field[data-pid="${id}"]`;
  const lifeOf = async (P, id) => Number((await P.textContent(`${field(id)} [data-life]`)).trim());
  const turnOf = (P) => P.evaluate(() => document.querySelector('.lc-field.turn')?.dataset.pid ?? null);
  const introCount = (P) => P.locator('[data-intro]').count();
  const cardAt = (P) => P.evaluate(() => {
    const c = document.querySelector('[data-intro-card]');
    return c ? { i: Number(c.getAttribute('data-intro-card')), pid: c.getAttribute('data-pid') } : null;
  });
  /** Kein Intro: Tisch steht, eine Weile (> Wartezeit 700 ms + erste Karte) beobachtet. */
  const noIntro = async (P) => {
    await P.waitForSelector('.lc-field');
    let seen = 0;
    for (let k = 0; k < 8; k++) { seen += await introCount(P); await P.waitForTimeout(250); }
    return seen === 0;
  };
  /** P8: Intro-Ereignisse im Seitenkontext mitschreiben (Karte eingefügt, data-phase → lie), Zeit = performance.now(). */
  const watch = (P) => P.evaluate(() => {
    if (!window.__ei) {
      const L = (window.__ei = []);
      new MutationObserver((ms) => {
        const t = performance.now();
        for (const m of ms) {
          if (m.type === 'attributes' && m.target.matches?.('[data-intro-card]')) L.push({ ev: 'phase', i: Number(m.target.dataset.introCard), v: m.target.dataset.phase, t });
          for (const n of m.addedNodes || []) {
            if (n.nodeType !== 1) continue;
            const c = n.matches?.('[data-intro-card]') ? n : n.querySelector?.('[data-intro-card]');
            if (c) L.push({ ev: 'card', i: Number(c.dataset.introCard), v: c.dataset.phase, t });
          }
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
    }
    window.__ei.length = 0;
  });
  /** Karte 1 „liegt“ → Karte 2 erscheint (ohne Tippen), in ms. */
  const lieGap = async (P) => {
    await P.waitForSelector('[data-intro-card="1"]', { timeout: 20000 });
    const L = await P.evaluate(() => window.__ei.slice());
    const lie = L.find((e) => e.i === 0 && e.v === 'lie')?.t;
    const next = L.find((e) => e.ev === 'card' && e.i === 1)?.t;
    return lie !== undefined && next !== undefined ? Math.round(next - lie) : null;
  };
  const secondsOf = async () => (await get('a', `playgroups?select=intro_seconds&id=eq.${fx.group}`))[0]?.intro_seconds;
  const abortGame = async () => {
    await A.click('.lc-hub');
    await A.click('[data-sheet="menu"] [data-m="end"]');
    await A.click('[data-sheet="end"] [data-e="aborted"]');
    await waitHash(A, '#/start');
  };

  // ---------------------------------------------------------------- Harness-Standard
  ok('Harness: frischer Kontext ⇒ startIntro false gespeichert', (await stored())?.startIntro === false, JSON.stringify(await stored()));
  ok('Intro einschalten (Einstellung „Intro beim Spielstart“)', await pref('startIntro', true));
  await A.reload();
  await A.waitForSelector('#view');
  ok('Init-Skript lässt einen gesetzten Wert stehen (nach Neuladen weiter true)', (await stored())?.startIntro === true);

  // ---------------------------------------------------------------- Spiel 1: Start über #/spiel-neu
  console.log('Intro: Spiel 1 über #/spiel-neu (A, B, C)');
  await A.goto(BASE + '#/spiel-neu');
  await A.waitForSelector('.su-row');
  const ids = Object.fromEntries(await A.$$eval('[data-act="member"]', (bs) => bs.map((b) => [b.querySelector('span').textContent.trim(), b.dataset.id])));
  const MA = ids['Franco Test'], MB = ids['Luka Test'], MC = ids['Tim Echt'];
  ok('Setup listet A, B, C', !!(MA && MB && MC), JSON.stringify(ids));
  for (const m of [MB, MC]) {
    if ((await A.getAttribute(`[data-act="member"][data-id="${m}"]`, 'aria-pressed')) !== 'true') await A.click(`[data-act="member"][data-id="${m}"]`);
  }
  await A.waitForSelector(`.su-row[data-mid="${MC}"]`);
  // C (ohne eigenes Deck) leiht eins; hätte B wider Erwarten keins, leiht B ebenfalls
  for (const m of [MC, MB]) if (await A.isDisabled('[data-act="start"]')) await A.click(`.su-row[data-mid="${m}"] [data-act="cycle"]`);
  await A.waitForFunction(() => { const b = document.querySelector('[data-act="start"]'); return b && !b.disabled; }, null, { timeout: 15000 });
  // P8 K30: das Setup lädt die ganze Karte (normal, aus image_url abgeleitet) von Deck A vor der Antwort auf rpc/start_game
  const wantNormal = normalFromArt((await get('a', `decks?select=image_url&id=eq.${tymna}`))[0]?.image_url);
  const normals = []; let startRes = null;
  const onReq = (r) => { if (/^https:\/\/cards\.scryfall\.io\/normal\//.test(r.url())) normals.push({ t: Date.now(), url: r.url() }); };
  const onRes = (r) => { if (/\/rest\/v1\/rpc\/start_game(\?|$)/.test(r.url()) && startRes === null) startRes = Date.now(); };
  A.on('request', onReq); A.on('response', onRes);
  await A.click('[data-act="start"]');
  await waitHash(A, '#/spiel/');
  const g1 = decodeURIComponent(new URL(A.url()).hash.slice('#/spiel/'.length));
  await A.waitForSelector('[data-intro-card="0"]', { timeout: 8000 });
  A.off('request', onReq); A.off('response', onRes);
  const early = normals.find((x) => x.url === wantNormal && startRes !== null && x.t <= startRes);
  ok('P8 K30 #/spiel-neu: normal-Adresse von Deck A (aus image_url) angefragt vor der Antwort rpc/start_game', !!wantNormal && !!early,
    `${wantNormal ? 'Soll abgeleitet' : 'keine art_crop-Adresse'} · Anfrage ${early ? `${startRes - early.t} ms vor` : 'nicht vor'} der Antwort`);
  const img0 = await A.getAttribute('[data-intro-card="0"]', 'data-img');
  console.log(`  (Messwert) Karte 1 data-img = ${img0}`);
  const segs = await A.locator('[data-intro-prog] > i').count();
  const c0 = await cardAt(A);
  ok('K29 Intro erscheint auf dem startenden Gerät, so viele Karten wie Spieler (3)', segs === 3 && (await A.locator('.lc-field').count()) === 3, `Segmente ${segs}`);
  ok('K29 Rolle dialog, „Überspringen“ hat den Fokus', (await A.getAttribute('[data-intro]', 'role')) === 'dialog'
    && (await A.evaluate(() => document.activeElement?.hasAttribute('data-intro-skip'))));
  await A.shot('p3-intro-karte1');
  await A.click('[data-intro]', { position: { x: 195, y: 420 } });
  await A.waitForSelector('[data-intro-card="1"]', { timeout: 3000 });
  const c1 = await cardAt(A);
  ok('K29 Tipp ⇒ Karte 2 (anderer Spieler)', c1?.i === 1 && c1.pid !== c0?.pid, JSON.stringify([c0, c1]));
  await A.click('[data-intro-skip]');
  await A.waitForSelector('[data-intro]', { state: 'detached', timeout: 3000 });
  ok('K29 erste Karte = Startspieler (am Zug nach dem Intro)', !!c0?.pid && c0.pid === (await turnOf(A)), JSON.stringify({ card: c0?.pid, turn: await turnOf(A) }));
  await A.waitForTimeout(450); // Klick-Schild (350 ms) ist weg
  const before = await lifeOf(A, MB);
  await A.click(`${field(MB)} .lc-tap.minus`);
  await A.waitForTimeout(200);
  ok('K29 „Überspringen“ ⇒ Tisch bedienbar (Tipp −1 ⇒ Leben −1)', (await lifeOf(A, MB)) === before - 1, `${before} → ${await lifeOf(A, MB)}`);
  await A.reload();
  ok('K29 Neuladen ⇒ kein Intro', await noIntro(A));

  // Konto B im zweiten Kontext öffnet dasselbe Spiel
  const B = await ctx(browser, 'IB');
  await B.goto(BASE);
  await waitHash(B, '#/login');
  await login(B, 'b');
  await waitHash(B, '#/start');
  await B.evaluate(async () => (await import('/src/lib/prefs.js')).setPref('startIntro', true));
  await B.goto(BASE + '#/spiel/' + encodeURIComponent(g1));
  ok('K29 Konto B (zweites Gerät, Intro an) öffnet das Spiel ⇒ kein Intro', await noIntro(B));
  ok('Keine JS-Fehler bei B', B.errs.length === 0, B.errs.join(' | '));
  ok('Keine HTTP-Fehler bei B', B.bad.length === 0, B.bad.join(' | '));
  await B.context().close();
  await abortGame();

  // ---------------------------------------------------------------- Spiel 2: über den Store, durchtippen
  const gid = await db('return state.groupId;');
  const start = (players, firstSeat = 0) => db(`return createStore(sb).startGame({ groupId: a.gid, layout: 'seiten', startingLife: 40, firstSeat: a.first,
      players: a.players.map((p, i) => ({ memberId: p[0], deckId: p[1], seat: i })) });`, { gid, first: firstSeat, players });
  const g2 = await start([[MA, tymna], [MB, krenko], [MC, tymna]], 1);
  ok('Spiel 2 gestartet (Store, B beginnt)', typeof g2 === 'string' && g2.length > 10, String(g2));
  await watch(A);
  await go('#/spiel/' + g2);
  await A.waitForSelector('[data-intro-card="0"]', { timeout: 8000 });
  const seen = [await cardAt(A)];
  // P8 K30: Karte 1 liegen lassen ⇒ Karte 2 kommt nach der Liegezeit der Gruppe (Fixture: 4 s, ohne Spalte ebenfalls 4 s)
  const gap4 = await lieGap(A);
  ok(`P8 K30 ${secLive ? '' : 'Übergang: '}Intro-Karte 1 „liegt“ → Karte 2 nach 4000 ± 400 ms`, gap4 !== null && Math.abs(gap4 - 4000) <= 400, `${gap4} ms`);
  seen.push(await cardAt(A));
  for (let k = 2; k < 3; k++) {
    await A.click('[data-intro]', { position: { x: 195, y: 420 } });
    await A.waitForSelector(`[data-intro-card="${k}"]`, { timeout: 3000 });
    seen.push(await cardAt(A));
  }
  await A.click('[data-intro]', { position: { x: 195, y: 420 } });
  await A.waitForSelector('[data-intro]', { state: 'detached', timeout: 3000 });
  ok('K29 Durchtippen: genau 3 Karten, Reihenfolge ab Startspieler B (B, C, A)', JSON.stringify(seen.map((c) => c?.pid)) === JSON.stringify([MB, MC, MA]),
    JSON.stringify(seen));
  ok('Nach dem letzten Tipp: Tisch, B am Zug', (await turnOf(A)) === MB);
  await A.waitForTimeout(450);
  await abortGame();

  // ---------------------------------------------------------------- Spiel 3: Einstellung aus
  ok('Intro ausschalten', await pref('startIntro', false));
  const g3 = await start([[MA, tymna], [MB, krenko]]);
  await go('#/spiel/' + g3);
  ok('K29 startIntro false ⇒ kein Intro (Spiel frisch auf diesem Gerät gestartet)', await noIntro(A));
  await abortGame();

  // ---------------------------------------------------------------- P8: Intro-Dauer der Gruppe bzw. Übergang
  if (secLive) {
    await pref('startIntro', true);
    const B2 = await ctx(browser, 'IB2');
    try {
      ok('P8 K30 Fixture-Gruppe steht auf 4 s', (await secondsOf()) === 4, String(await secondsOf()));
      await A.goto(BASE + '#/gruppen');
      await A.waitForSelector('[data-intro-setting]', { timeout: 10000 });
      ok('P8 K30 A (Admin) sieht die Intro-Karte mit „4 s“', (await A.textContent('[data-intro-seconds]')) === '4 s', await A.textContent('[data-intro-seconds]'));
      await A.click('[data-act="intro-less"]');
      await A.click('[data-act="intro-less"]');
      await A.click('[data-act="intro-save"]');
      for (let k = 0; k < 20 && (await secondsOf()) !== 2; k++) await A.waitForTimeout(250);
      await A.reload();
      await A.waitForSelector('[data-intro-setting]', { timeout: 10000 });
      ok('P8 K30 A setzt 2 über die UI ⇒ Neuladen zeigt „2 s“', (await A.textContent('[data-intro-seconds]')) === '2 s' && (await secondsOf()) === 2, await A.textContent('[data-intro-seconds]'));
      const g5 = await start([[MA, tymna], [MB, krenko]]);
      await watch(A);
      await go('#/spiel/' + g5);
      await A.waitForSelector('[data-intro-card="0"]', { timeout: 8000 });
      const gap2 = await lieGap(A);
      ok('P8 K30 Spielstart ⇒ Karte 1 „liegt“ → Karte 2 nach 2000 ± 400 ms', gap2 !== null && Math.abs(gap2 - 2000) <= 400, `${gap2} ms`);
      await A.click('[data-intro-skip]');
      await A.waitForSelector('[data-intro]', { state: 'detached', timeout: 3000 });
      await A.waitForTimeout(450);
      await abortGame();
      await B2.goto(BASE);
      await waitHash(B2, '#/login');
      await login(B2, 'b');
      await waitHash(B2, '#/start');
      await B2.goto(BASE + '#/gruppen');
      await B2.waitForSelector('[data-invite-none]', { timeout: 10000 });
      ok('P8 K30 B (Mitglied) sieht keine Intro-Karte', (await B2.locator('[data-intro-setting]').count()) === 0);
      let rpcErr = null;
      try { await rpc('b', 'set_intro_seconds', { p_group: fx.group, p_seconds: 9 }); } catch (e) { if (e instanceof Abort) throw e; rpcErr = e; }
      ok('P8 K30 B ruft rpc/set_intro_seconds direkt ⇒ Fehler not_group_admin, Wert bleibt 2', /not_group_admin/.test(rpcErr?.message || '') && (await secondsOf()) === 2, `${rpcErr?.status} ${rpcErr?.body?.message ?? ''}`);
      let patchErr = null;
      try { await api('PATCH', rest(`playgroups?id=eq.${fx.group}`), { token: (await signIn('b')).token, body: { intro_seconds: 9 } }); } catch (e) { if (e instanceof Abort) throw e; patchErr = e; }
      ok('P8 K30 B PATCH playgroups { intro_seconds: 9 } ⇒ Fehler 42501, Wert bleibt 2', patchErr?.code === '42501' && (await secondsOf()) === 2, `${patchErr?.status} ${patchErr?.code}`);
      ok('Keine JS-Fehler bei B (Gruppen-Seite)', B2.errs.length === 0, B2.errs.join(' | '));
    } finally {
      await B2.context().close().catch(() => {});
      await rpc('a', 'set_intro_seconds', { p_group: fx.group, p_seconds: 4 });
    }
    ok('P8 K30 Aufgeräumt: Fixture-Gruppe wieder 4 s', (await secondsOf()) === 4, String(await secondsOf()));
  } else {
    for (const n of ['P8 K30 A sieht die Intro-Karte mit „4 s“, setzt 2 ⇒ Neuladen „2 s“', 'P8 K30 Spielstart ⇒ Liegezeit 2000 ± 400 ms',
      'P8 K30 B sieht keine Karte', 'P8 K30 B rpc/set_intro_seconds ⇒ not_group_admin', 'P8 K30 B PATCH playgroups ⇒ 42501', 'P8 K30 Aufgeräumt: wieder 4 s']) skip(n, 'Migration nicht in Prod');
    const badBefore = A.bad.length;
    await A.goto(BASE + '#/gruppen');
    await A.waitForSelector('[data-invite]', { timeout: 10000 });
    await A.waitForTimeout(800);
    ok('P8 K30 Übergang: A (Admin) auf #/gruppen ohne Intro-Karte', (await A.locator('[data-intro-setting]').count()) === 0);
    ok('P8 K30 Übergang: keine Antwort ≥ 400 auf #/gruppen', A.bad.length === badBefore, A.bad.slice(badBefore).join(' | '));
  }

  // ---------------------------------------------------------------- Motto bzw. Übergang
  if (live) {
    await pref('startIntro', true);
    try {
      await A.goto(BASE + '#/deck/' + encodeURIComponent(tymna));
      await A.waitForSelector('[data-act="motto"]', { timeout: 10000 });
      await A.click('[data-act="motto"]');
      await A.fill('#dm-motto', `  ${MOTTO}  `);
      await A.click('.sheet button[type=submit]');
      await A.waitForSelector('[data-motto]', { timeout: 10000 });
      const row = (await get('a', `decks?select=motto&id=eq.${tymna}`))[0];
      ok('K29 Motto im Deckprofil gespeichert (getrimmt)', row?.motto === MOTTO && (await A.textContent('[data-motto]')).includes(MOTTO), JSON.stringify(row));
      const g4 = await start([[MA, tymna], [MB, krenko]]);
      await go('#/spiel/' + g4);
      await A.waitForSelector('[data-intro-card="0"]', { timeout: 8000 });
      const line = await A.textContent('[data-intro-card="0"] [data-line]').catch(() => '');
      ok('K29 Karte von A zeigt das Motto', (await A.getAttribute('[data-intro-card="0"] [data-line]', 'data-line').catch(() => '')) === 'motto' && line.includes(MOTTO), line);
      await A.shot('p3-intro-motto');
      await A.click('[data-intro-skip]');
      await A.waitForSelector('[data-intro]', { state: 'detached', timeout: 3000 });
      await A.waitForTimeout(450);
      await abortGame();
    } finally {
      const s = await signIn('a');
      await api('PATCH', rest(`decks?id=eq.${tymna}`), { token: s.token, body: { motto: null } });
    }
    const left = await get('a', 'decks?select=id&motto=not.is.null');
    ok('K29 Aufgeräumt: kein Deck der Fixture mit Motto', left.length === 0, String(left.length));
  } else {
    for (const n of ['K29 Motto im Deckprofil speichern', 'K29 Karte zeigt das Motto', 'K29 Aufgeräumt: kein Deck mit Motto']) skip(n, 'Migration nicht in Prod');
    const badBefore = A.bad.length;
    await A.goto(BASE + '#/deck/' + encodeURIComponent(tymna));
    await A.waitForSelector('[data-act="bracket"]', { timeout: 10000 });
    await A.waitForTimeout(800);
    ok('K29 Übergang: Deckprofil ohne Spalte ⇒ kein Motto-Feld, kein Motto-Knopf (Bearbeiten-Bereich steht)',
      (await A.locator('[data-motto], [data-act="motto"]').count()) === 0);
    ok('K29 Übergang: keine Antwort ≥ 400 im Deckprofil', A.bad.length === badBefore, A.bad.slice(badBefore).join(' | '));
  }

  ok('Keine JS-Fehler bei A', A.errs.length === 0, A.errs.join(' | '));
  ok('Keine HTTP-Fehler bei A', A.bad.length === 0, A.bad.join(' | '));
}
