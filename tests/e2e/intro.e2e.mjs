// E2E Spielstart-Intro (Spec P3, Welle ttg-features, Kriterium 29) unter dem P9b-Harness: feste Konten A/B/C,
// nur TTG-E2E-Fixture, Grundzustand davor und danach (run.mjs). Der Harness schaltet das Intro für alle anderen
// Dateien aus (ctx(): startIntro false, wenn der Schlüssel fehlt); diese Datei schaltet es gezielt ein.
// Spiel 1 startet über #/spiel-neu (wie am Tisch), Spiel 2 und 3 über den Store der App (gleiche Modul-Instanz,
// gleicher Merker „frisch gestartet“). Jedes gestartete Spiel wird verworfen.
// Motto-Fälle hängen an mottoLive() (Spalte decks.motto in Prod?); vorher sichtbar übersprungen, dafür läuft der
// Übergangsfall „Deckprofil ohne Spalte: kein Motto-Feld, keine Antwort ≥ 400“.
import { ok, skip, ctx, waitHash, login, prepare, Abort, signIn, api, rest, get } from './harness.mjs';

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

export default async function introE2e({ browser, base: BASE }) {
  const { decks } = await prepare({ members: ['b', 'c'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  const tymna = decks['a:tymna'], krenko = decks['b:krenko'];
  const live = await mottoLive();
  console.log(`\nIntro: Motto-Spalte in Prod: ${live ? 'ja' : 'nein (Motto-Fälle werden übersprungen)'}`);

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
  await A.click('[data-act="start"]');
  await waitHash(A, '#/spiel/');
  const g1 = decodeURIComponent(new URL(A.url()).hash.slice('#/spiel/'.length));
  await A.waitForSelector('[data-intro-card="0"]', { timeout: 8000 });
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
  await go('#/spiel/' + g2);
  await A.waitForSelector('[data-intro-card="0"]', { timeout: 8000 });
  const seen = [await cardAt(A)];
  for (let k = 1; k < 3; k++) {
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
