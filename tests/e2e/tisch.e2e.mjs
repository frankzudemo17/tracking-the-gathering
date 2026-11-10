// E2E Tisch-Einstellungen + Spiel-Standards + Bracket-Hinweis (P7 der Welle ttg-live-feinschliff-decks,
// spec-p7-tisch.md Kriterien 3–8). Läuft alphabetisch nach etappe1-2, setup und spiel-ko und nutzt deren Konten
// (A = „Franco Test“ mit Deck Tymna, Bracket 2 · B = „Luka Test“ · C = „Tim Echt“). Legt kein Konto und keine Gruppe an;
// das eigene Testdeck wird am Ende gelöscht, jedes gestartete Spiel abgebrochen.
// Attrappen per addInitScript: navigator.wakeLock (zählt request/release), navigator.vibrate (zählt Aufrufe),
// document.visibilityState (steuerbar, für „Tab verstecken/zeigen“).
// P9b: feste Testkonten (login(page, 'a'|'b'|'c')) in TTG-E2E-Fixture; run.mjs stellt vorher den Grundzustand her,
// prepare() den Stand, den die alte Kette hier hinterließ (nach setup: zusätzlich Platzhalter „Jo Test“ und B mit Krenko).
import { ok, ctx, waitHash, login, hash, prepare } from './harness.mjs';

const K = (k) => k / 2 ** 32;

export default async function tischE2e({ browser, base: BASE }) {
  await prepare({ members: ['b', 'c'], placeholders: ['Jo Test'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  console.log('\nTisch-Einstellungen: Anmelden als A (Franco Test)');
  const P = await ctx(browser, 'Tisch');
  await P.addInitScript(() => {
    window.__wl = { req: 0, rel: 0 };
    const mk = () => {
      const l = new EventTarget();
      l.released = false;
      l.type = 'screen';
      l.release = async () => { if (l.released) return; l.released = true; window.__wl.rel++; l.dispatchEvent(new Event('release')); };
      return l;
    };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__wl.req++; return mk(); } } });
    window.__vib = 0;
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { window.__vib++; return true; } });
    window.__vis = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__vis === 'hidden' });
  });
  await P.goto(BASE);
  await waitHash(P, '#/login');
  await login(P, 'a');
  await waitHash(P, '#/start');
  ok('A angemeldet (Konto aus etappe1-2)', true);

  const db = (fn, arg) => P.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    const { createStore } = await import('/src/lib/game-store.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'createStore', 'a', `return (async () => { ${src} })()`)(sb, state, createStore, a);
  }, [fn, arg]);
  /** Einstellung direkt im App-Modul setzen (gleiche Modul-Instanz wie die App ⇒ Hörer feuern). */
  const pref = (key, value) => P.evaluate(async ([k, v]) => (await import('/src/lib/prefs.js')).setPref(k, v), [key, value]);
  const wl = () => P.evaluate(() => ({ ...window.__wl }));
  const vib = () => P.evaluate(() => window.__vib);
  const setVis = (v) => P.evaluate((x) => { window.__vis = x; document.dispatchEvent(new Event('visibilitychange')); }, v);
  const go = (h) => P.evaluate((x) => { location.hash = x; }, h);
  const field = (id) => `.lc-field[data-pid="${id}"]`;
  const tap = async (id, n) => { for (let i = 0; i < n; i++) await P.click(`${field(id)} .lc-tap.minus`); };
  const force = (ks) => P.evaluate((q) => { window.__q = q.slice(); window.__ttgRand = () => (window.__q.length ? window.__q.shift() : 0.5); }, ks.map(K));
  const abortGame = async () => {
    await P.click('.lc-hub');
    await P.click('[data-sheet="menu"] [data-m="end"]');
    await P.click('[data-sheet="end"] [data-e="aborted"]');
    await waitHash(P, '#/start');
  };

  const gid = await db('return state.groupId;');
  const mem = await db("const r = await sb.from('members').select('id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n)?.id;
  const A = byName('Franco Test'), B = byName('Luka Test'), C = byName('Tim Echt');
  ok('Gruppe hat A, B, C', !!(A && B && C), JSON.stringify(mem));
  const tymna = await db("const q = await sb.from('decks').select('id, bracket, bracket_check').ilike('commander_name', 'Tymna%').eq('archived', false).limit(1); return q.data?.[0];");
  ok('Deck Tymna vorhanden (Bracket 2, ohne Prüfung)', tymna?.bracket === 2 && !tymna.bracket_check, JSON.stringify(tymna));

  // ---------------------------------------------------------------- Kriterium 7a: Standards vorher/nachher
  await P.goto(BASE + '#/spiel-neu');
  await P.waitForSelector('.su-row');
  ok('K7 ohne Einstellung: Startleben 40, Layout Seiten', (await P.textContent('.su-lifebig')).trim() === '40'
    && (await P.getAttribute('[data-act="layout"][data-l="seiten"]', 'aria-pressed')) === 'true');

  await P.goto(BASE + '#/einstellungen');
  await P.waitForSelector('[data-settings="table"] [data-pref="wakeLock"]');
  ok('Einstellungen: Abschnitte „Am Tisch“ und „Spiel-Standards“ zwischen Erscheinungsbild und Konto', await P.evaluate(() => {
    const secs = [...document.querySelectorAll('#view .section-title')].map((h) => h.textContent.trim());
    return secs.indexOf('Am Tisch') > 0 && secs.indexOf('Spiel-Standards') === secs.indexOf('Am Tisch') + 1 && secs.indexOf('Konto') === secs.indexOf('Spiel-Standards') + 1;
  }));
  ok('Schalter mit role="switch" und aria-checked (Wake Lock, Vibration, Zugzeit an)', (await P.locator('[role="switch"][aria-checked="true"]').count()) === 3);
  await P.click('[data-pref="startLife"][data-v="30"]');
  await P.click('[data-pref="layout"][data-v="rundum"]');
  await P.click('[data-pref="defaultPins"][data-v="energy"]');
  await P.click('[data-pref="defaultPins"][data-v="tax"]');
  await P.click('[data-pref="turnTime"]');
  await P.click('[data-pref="koScreens"][data-v="some"]');
  ok('K.O. „Einzelne“ ⇒ Häkchenliste mit A, B, C sichtbar', (await P.locator('[data-pref="koVariants"][role="checkbox"]').count()) === 3);
  await P.click('[data-pref="koVariants"][data-v="B"]');
  await P.click('[data-pref="koVariants"][data-v="C"]');
  ok('Letzte Variante lässt sich nicht abwählen', (await P.getAttribute('[data-pref="koVariants"][data-v="A"]', 'aria-disabled')) === 'true');
  await P.click('[data-pref="koVariants"][data-v="A"]', { force: true });
  const stored = await P.evaluate(() => JSON.parse(localStorage.getItem('ttg.prefs.v1')));
  ok('Gespeichert in ttg.prefs.v1 (Startleben 30, rundum, Pins Gift+Energie, Zugzeit aus, K.O. nur A)', stored?.startLife === 30 && stored.layout === 'rundum'
    && JSON.stringify(stored.defaultPins) === '["poison","energy"]' && stored.turnTime === false && stored.koScreens === 'some' && JSON.stringify(stored.koVariants) === '["A"]', JSON.stringify(stored));
  ok('Zugzeit aus ⇒ html[data-turntime="off"]', (await P.evaluate(() => document.documentElement.dataset.turntime)) === 'off');
  ok('Seite blieb stehen (kein Neuaufbau beim Umschalten)', (await P.getAttribute('[data-pref="turnTime"]', 'aria-checked')) === 'false' && P.errs.length === 0, P.errs.join(' | '));

  await P.goto(BASE + '#/spiel-neu');
  await P.waitForSelector('.su-row');
  ok('K7 #/spiel-neu: Startleben 30 und Layout Rundum vorgewählt (trotz Entwurf vom ersten Besuch)', (await P.textContent('.su-lifebig')).trim() === '30'
    && (await P.getAttribute('[data-act="layout"][data-l="rundum"]', 'aria-pressed')) === 'true');

  // Drei Spieler: A (eigenes Deck), B (eigenes oder Leihdeck), C (Leihdeck)
  for (const id of [B, C]) if ((await P.getAttribute(`[data-act="member"][data-id="${id}"]`, 'aria-pressed')) !== 'true') await P.click(`[data-act="member"][data-id="${id}"]`);
  for (const id of [A, B, C]) if ((await P.locator(`.su-row[data-mid="${id}"] .su-deckbtn`).count()) === 0) await P.click(`.su-row[data-mid="${id}"] [data-act="cycle"]`);
  ok('Drei Spieler mit Deck ⇒ Start frei', !(await P.isDisabled('[data-act="start"]')), await P.textContent('.su-go'));

  // ---------------------------------------------------------------- Kriterium 4: Vibration beim Würfeln
  const roll = async () => {
    await P.click('[data-act="roll"]');
    await P.waitForSelector('.dt .dt-die');
    await P.waitForTimeout(300);
    await force([0, 2, 4]); // Würfe 1, 3, 5 (randInt(6) = k % 6) ⇒ kein Gleichstand
    const b = await P.locator('.dt-felt').boundingBox();
    await P.mouse.move(b.x + b.width / 2, b.y + b.height - 70);
    await P.mouse.down();
    await P.mouse.move(b.x + b.width / 2 + 40, b.y + b.height - 260, { steps: 4 });
    await P.mouse.up();
    await P.waitForFunction(() => document.querySelector('.dt')?.dataset.phase === 'done', null, { timeout: 10000 });
    await P.click('[data-dice="close"]');
    await P.waitForSelector('.dt', { state: 'detached' });
  };
  await pref('vibration', false);
  await P.evaluate(() => { window.__vib = 0; });
  await roll();
  ok('K4 Vibration aus ⇒ Würfeln ruft navigator.vibrate 0×', (await vib()) === 0, String(await vib()));
  await pref('vibration', true);
  await roll();
  ok('K4 Vibration an ⇒ Würfeln ruft navigator.vibrate ≥ 1×', (await vib()) >= 1, String(await vib()));

  // ---------------------------------------------------------------- Kriterium 7b + 3: Spiel starten, Wake Lock
  ok('K3 vor dem Spiel: keine Wake-Lock-Anfrage', (await wl()).req === 0, JSON.stringify(await wl()));
  await P.click('[data-act="start"]');
  await waitHash(P, '#/spiel/');
  const g1 = hash(P).split('/')[2];
  await P.waitForSelector('.lc-field');
  await P.waitForTimeout(500);
  const g = await db("const r = await sb.from('games').select('layout, starting_life').eq('id', a).single(); return r.data;", g1);
  ok('K7 gestartetes Spiel: starting_life = 30, layout = rundum (REST)', g?.starting_life === 30 && g?.layout === 'rundum', JSON.stringify(g));
  ok('K3 /spiel/<id> ⇒ 1 request', (await wl()).req === 1, JSON.stringify(await wl()));
  await setVis('hidden');
  await P.waitForTimeout(150);
  ok('K3 Tab versteckt ⇒ release', (await wl()).rel === 1, JSON.stringify(await wl()));
  await setVis('visible');
  await P.waitForTimeout(150);
  ok('K3 Tab wieder sichtbar ⇒ 2. request', (await wl()).req === 2, JSON.stringify(await wl()));

  // Kriterium 7c: Zugzeit aus
  ok('K7 Zugzeit aus ⇒ Zugzeit im Lifecounter nicht sichtbar, „am Zug“-Rahmen bleibt',
    (await P.locator('.lc-turnchip').count()) >= 1 && !(await P.locator('.lc-turnchip').first().isVisible()) && (await P.locator('.lc-field.turn').count()) === 1);

  // ---------------------------------------------------------------- Kriterium 5 + 4: K.O. aus / einzelne
  await pref('vibration', false);
  await pref('koScreens', 'off');
  await P.evaluate(() => { window.__vib = 0; });
  await tap(B, 30);
  await P.waitForSelector('.sheet-wrap [data-sheet="ko"]');
  ok('K5 K.O. aus ⇒ kein K.O.-Screen im DOM, nur „Wer war es?“-Sheet', (await P.locator('.ko').count()) === 0);
  await P.shot('p7-ko-aus-sheet');
  await P.click(`.sheet-wrap [data-ko="by"][data-by="${A}"]`);
  await P.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await P.waitForTimeout(300);
  ok('K5 Ausscheiden ohne Screen funktioniert (B raus durch A)', /Platz 3/.test(await P.textContent(`${field(B)} .lc-plaque`)) && /Franco Test/.test(await P.textContent(`${field(B)} .lc-plaque`)));
  ok('K4 Vibration aus ⇒ K.O. ruft navigator.vibrate 0×', (await vib()) === 0, String(await vib()));
  ok('K5 kein .ko nach dem Ausscheiden', (await P.locator('.ko').count()) === 0);

  await pref('vibration', true);
  await pref('koScreens', 'some');
  await force([2, 2]); // koPick zieht Variante C, Spruch 2 — erlaubt ist nur A
  await tap(C, 30);
  await P.waitForSelector('.ko[data-stage="9"]');
  ok('K5 „Einzelne“ nur A ⇒ gezogene Variante C wird zu A', (await P.getAttribute('.ko', 'data-variant')) === 'A', await P.getAttribute('.ko', 'data-variant'));
  ok('K4 Vibration an ⇒ K.O. ruft navigator.vibrate ≥ 1×', (await vib()) >= 1, String(await vib()));
  await P.click('.ko [data-ko="cancel"]');
  await P.waitForFunction(() => !document.querySelector('.ko'));

  // ---------------------------------------------------------------- Kriterium 6: Weniger Bewegung an
  await pref('reduceMotion', 'on');
  ok('K6 „Weniger Bewegung: An“ ⇒ html[data-motion="reduce"]', (await P.evaluate(() => document.documentElement.dataset.motion)) === 'reduce');
  await P.click(`${field(C)} [data-act="ko"]`);
  await P.waitForSelector('.ko');
  const mo = await P.evaluate(() => {
    const r = document.querySelector('.ko');
    const sec = (s) => Math.max(...String(s).split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x))));
    const els = [r, ...r.querySelectorAll('.ko-layer, .ko-box, .ko-lines, .ko-sub')];
    return { stage: r.dataset.stage, anim: Math.max(...els.map((e) => sec(getComputedStyle(e).animationDuration))), trans: Math.max(...els.map((e) => sec(getComputedStyle(e).transitionDuration))), running: document.getAnimations().length };
  });
  ok('K6 K.O.-Screen sofort Stufe 9, animation-/transition-duration ≤ 0,01 s', mo.stage === '9' && mo.anim <= 0.01 && mo.trans <= 0.01, JSON.stringify(mo));
  await P.click('.ko [data-ko="cancel"]');
  await P.waitForFunction(() => !document.querySelector('.ko'));

  // Route verlassen (Spiel abbrechen ⇒ #/start)
  await abortGame();
  await P.waitForTimeout(200);
  ok('K3 Route verlassen ⇒ release', (await wl()).rel === 2, JSON.stringify(await wl()));

  // Schalter aus ⇒ 0 request
  await pref('wakeLock', false);
  await pref('reduceMotion', 'system');
  const g2 = await db(`return createStore(sb).startGame({ groupId: a.gid, layout: 'seiten', startingLife: 20, firstSeat: 0,
      players: a.ids.map((id, i) => ({ memberId: id, deckId: a.deck, seat: i })) });`, { gid, ids: [A, B], deck: tymna.id });
  const before = (await wl()).req;
  await go('#/spiel/' + g2);
  await P.waitForSelector('.lc-field');
  await P.waitForTimeout(400);
  ok('K3 Schalter aus ⇒ 0 request auf /spiel/<id>', (await wl()).req === before, JSON.stringify(await wl()));
  await abortGame();

  // ---------------------------------------------------------------- Kriterium 7d + 8: neues Deck, Bracket-Hinweis
  await P.goto(BASE + `#/deck-neu/${A}`);
  await P.waitForSelector('#ad-q');
  await P.fill('#ad-q', 'krenko');
  await P.waitForSelector('.result >> text=Krenko, Mob Boss', { timeout: 20000 });
  await P.click('.result >> text=Krenko, Mob Boss');
  await P.click('[data-br="4"]');
  await P.click('[data-act="save"]');
  await waitHash(P, '#/deck/');
  const newDeck = hash(P).split('/')[2];
  try {
    const nd = await db("const r = await sb.from('decks').select('counter_pins, bracket').eq('id', a).single(); return r.data;", newDeck);
    ok('K7 neues Deck ⇒ counter_pins = eingestellte Pins (Gift, Energie)', JSON.stringify(nd?.counter_pins) === '["poison","energy"]' && nd.bracket === 4, JSON.stringify(nd));

    await P.evaluate(([g, a, b, d1, d2]) => sessionStorage.setItem(`ttg.setup.${g}`, JSON.stringify({ sel: [a, b], deck: { [a]: d1, [b]: d2 } })), [gid, A, B, tymna.id, newDeck]);
    await P.goto(BASE + '#/spiel-neu');
    await P.waitForSelector('.su-row');
    const hintTxt = await P.locator('[data-bracket-hint]').textContent().catch(() => null);
    ok('K8 Deck Bracket 2 + Deck Bracket 4 ⇒ Hinweis über dem Start-Knopf', /Brackets 2 und 4 am Tisch/.test(hintTxt ?? ''), String(hintTxt));
    ok('K8 Start bleibt möglich', !(await P.isDisabled('[data-act="start"]')) && (await P.locator('[data-why]').count()) === 0);
    await P.evaluate(() => document.querySelector('[data-bracket-hint]')?.scrollIntoView({ block: 'center' }));
    await P.shot('p7-setup-bracket-hinweis');
    await P.click(`.su-row[data-mid="${B}"] [data-act="cycle"]`); // anderes Deck ⇒ kein Hinweis mehr (Risiko 4)
    const deckB = await P.textContent(`.su-row[data-mid="${B}"] .su-deckbtn`);
    const still = await P.locator('[data-bracket-hint]').count();
    const idB = await P.evaluate(([g, b]) => JSON.parse(sessionStorage.getItem(`ttg.setup.${g}`))?.deck?.[b], [gid, B]);
    const bracketB = await db("const r = await sb.from('decks').select('bracket, bracket_check, short_name').eq('id', a).maybeSingle(); return r.data;", idB);
    const eff = bracketB?.bracket_check?.floor ? Math.max(2, bracketB.bracket_check.floor) : bracketB?.bracket;
    const checkB = (bracketB?.bracket_check?.floor ?? 0) > (bracketB?.bracket ?? 9);
    ok('K8 Hinweis nach Deckwechsel neu bewertet (nur bei ≥ 2 Stufen bzw. höher geprüftem Deck)', (Math.abs((eff ?? 2) - 2) >= 2 || checkB) === (still === 1), JSON.stringify({ deckB, bracketB, still }));
  } finally {
    await P.evaluate((g) => sessionStorage.removeItem(`ttg.setup.${g}`), gid);
    const del = await db("const r = await sb.from('decks').delete().eq('id', a).select('id'); return r.error ? r.error.message : r.data.length;", newDeck);
    ok('Testdeck wieder gelöscht', del === 1, String(del));
  }
  ok('Keine Seitenfehler', P.errs.length === 0, P.errs.join(' | '));
}
