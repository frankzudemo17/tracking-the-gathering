// E2E K.O.-Screens (Spec P11, Kriterien 1–5 + Negativraum). Dateiname laut Nachtrag Dirigent 2026-11-10:
// läuft alphabetisch NACH etappe1-2, life und setup und nutzt deren Konten (A = „Franco Test“, B = „Luka Test“,
// C = „Tim Echt“, Deck Tymna). Legt kein Konto, keine Gruppe, kein Deck an; jedes gestartete Spiel wird verworfen.
// Variante + Spruch werden über den Testhaken window.__ttgRand (src/lib/rand.js, nur localhost) erzwungen:
// koPick(rand) zieht randInt(3) (Variante) und randInt(8) (Spruch, bei B und 0 zusätzlich 1 + randInt(7));
// rand() = k / 2^32 ergibt randInt(n) = k % n.
// P9b: feste Testkonten (login(page, 'a'|'b'|'c')) in TTG-E2E-Fixture; run.mjs stellt vorher den Grundzustand her,
// prepare() den Stand, den die alte Kette hier hinterließ (nach setup: zusätzlich Platzhalter „Jo Test“ und B mit Krenko).
import { ok, ctx, waitHash, login, prepare } from './harness.mjs';

const K = (k) => k / 2 ** 32;
const LONG = 'Maximiliane Konstanze von Hohenzollern-S'; // 40 Zeichen

export default async function koE2e({ browser, base: BASE }) {
  await prepare({ members: ['b', 'c'], placeholders: ['Jo Test'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  console.log('\nK.O.-Screens: Anmelden als A (Franco Test)');
  const P = await ctx(browser, 'KO');
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
  const poll = async (fn, arg, pred, ms = 10000) => {
    const end = Date.now() + ms; let v;
    do { v = await db(fn, arg); if (pred(v)) return v; await P.waitForTimeout(300); } while (Date.now() < end);
    return v;
  };

  const gid = await db('return state.groupId;');
  const mem = await db("const r = await sb.from('members').select('id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n)?.id;
  const A = byName('Franco Test'), B = byName('Luka Test'), C = byName('Tim Echt');
  ok('Gruppe hat A, B, C', !!(A && B && C), JSON.stringify(mem));
  const deck = await db("const q = await sb.from('decks').select('id').ilike('commander_name', 'Tymna%').eq('archived', false).limit(1); return q.data?.[0];");
  ok('Deck Tymna vorhanden', !!deck?.id, JSON.stringify(deck));
  const start = () => db(`return createStore(sb).startGame({ groupId: a.gid, layout: 'seiten', startingLife: 20, firstSeat: 0,
      players: a.ids.map((id, i) => ({ memberId: id, deckId: a.deck, seat: i })) });`, { gid, ids: [A, B, C], deck: deck.id });
  const field = (id) => `.lc-field[data-pid="${id}"]`;
  const tap = async (pg, id, n) => { for (let i = 0; i < n; i++) await pg.click(`${field(id)} .lc-tap.minus`); };
  const force = (pg, ks) => pg.evaluate((q) => { window.__q = q.slice(); window.__ttgRand = () => (window.__q.length ? window.__q.shift() : 0.5); }, ks.map(K));
  const quotes = await P.evaluate(async () => (await import('/src/i18n/de-ko.js')).default.quotes);
  const koInfo = (pg) => pg.evaluate(() => {
    const r = document.querySelector('.ko');
    return r && { v: r.dataset.variant, q: Number(r.dataset.quote), stage: r.dataset.stage, quote: r.querySelector('[data-ko-quote]')?.textContent ?? '',
      ask: !!r.querySelector('[data-ko="ask"]'), out: r.querySelector('[data-ko="out"]')?.textContent.trim() ?? null, wins: r.querySelector('[data-ko-wins]')?.textContent ?? null,
      // B1/B2 (Nachtrag 13:45): Rundenzahl je Variante, A-Tag, Lebensbalken C
      tag: r.querySelector('.ko-a .ko-tag')?.textContent.trim() ?? null, aLine: r.querySelector('.ko-a .ko-line')?.textContent.trim() ?? null,
      bLine: r.querySelector('.ko-b-line')?.textContent.trim() ?? null, bCard: r.querySelector('[data-ko-card-line]')?.textContent.trim() ?? null,
      cRound: r.querySelector('[data-ko-round]')?.textContent.trim() ?? null, segs: r.querySelector('[data-ko-segs]')?.dataset.koSegs ?? null };
  });
  const abort = async (pg) => {
    await pg.click('.lc-hub');
    await pg.click('[data-sheet="menu"] [data-m="end"]');
    await pg.click('[data-sheet="end"] [data-e="aborted"]');
    await waitHash(pg, '#/start');
  };
  // Stufenfolge des nächsten Screens mitschreiben (Kriterium 5: läuft vollständig, nie rückwärts)
  const watchStages = (pg) => pg.evaluate(() => {
    window.__stages = [];
    const seen = new WeakSet();
    const mo = new MutationObserver(() => {
      for (const r of document.querySelectorAll('.ko')) {
        if (seen.has(r)) continue;
        seen.add(r);
        window.__stages.push(r.dataset.stage);
        new MutationObserver(() => window.__stages.push(r.dataset.stage)).observe(r, { attributes: true, attributeFilter: ['data-stage'] });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });

  // ---------------------------------------------------------------- Kriterium 2 + 3: A, B, C erzwungen
  const g1 = await start();
  ok('Spiel 1 gestartet', typeof g1 === 'string' && g1.length > 10, String(g1));
  await P.goto(BASE + '#/spiel/' + g1);
  await P.waitForSelector('.lc-field');
  await force(P, [0, 3]); // A, Spruch 4 („Wasted.“)
  await tap(P, B, 20);
  await P.waitForSelector('.ko[data-stage="9"]');
  let k = await koInfo(P);
  ok('K2 erzwungen: Variante A mit Spruch Index 3', k?.v === 'A' && k.q === 3 && k.quote.includes(quotes[3]), JSON.stringify(k));
  ok('K3 B auf 0 (Tippen) ⇒ K.O.-Screen ohne Verursacher ⇒ „Wer war es?“', k?.ask === true && k.out === null, JSON.stringify(k));
  ok('B1 A live: „fällt in Runde 1“ (Runde aus dem Spiel)', k?.aLine === 'fällt in Runde 1', JSON.stringify(k));
  ok('B2 A-Tag „FINISH HIM!“', k?.tag === 'FINISH HIM!', JSON.stringify(k));
  await P.shot('p11-01-live-A');
  await P.click('.ko [data-ko="cancel"]');
  await P.waitForSelector(`${field(B)} [data-act="ko"]`);
  ok('K3 „Doch nicht“ ⇒ Feld zeigt „Ausgeschieden?“', (await P.textContent(`${field(B)} [data-act="ko"]`)).includes('Ausgeschieden?'));
  await P.waitForTimeout(1000);
  ok('K5 1 s nach dem Schließen: kein .ko im DOM', (await P.locator('.ko').count()) === 0);

  await force(P, [1, 0, 3]); // B, Spruch 0 verlangt ⇒ koPick zieht neu: 1 + 3 = 4
  await P.click(`${field(B)} [data-act="ko"]`);
  await P.waitForSelector('.ko[data-stage="9"]');
  k = await koInfo(P);
  ok('K2 erzwungen: Variante B', k?.v === 'B', JSON.stringify(k));
  ok('K2 B zeigt nie Spruch 1 (Stub verlangt Index 0 ⇒ Index 4)', k?.q === 4 && !k.quote.includes(quotes[0]) && k.quote.includes(quotes[4]), JSON.stringify(k));
  ok('B1 B live: Zeile „Runde 1 · Platz 3“, Karte „Runde 1 · Tymna …“', k?.bLine === 'Runde 1 · Platz 3' && /^Runde 1 · Tymna/.test(k.bCard ?? ''), JSON.stringify(k));
  ok('B: Titel „… wurde ins Reich der Schatten geschickt“', /Luka Test wurde ins Reich der Schatten geschickt/.test(await P.textContent('.ko .ko-b-title')));
  await P.shot('p11-02-live-B');
  await P.keyboard.press('Escape');
  await P.waitForFunction(() => !document.querySelector('.ko'));
  ok('Escape = „Doch nicht“ ⇒ Feld zeigt weiter „Ausgeschieden?“', (await P.textContent(`${field(B)} [data-act="ko"]`)).includes('Ausgeschieden?'));

  await force(P, [2, 2]); // C, Spruch 3 („Fatality.“)
  await P.click(`${field(B)} [data-act="ko"]`);
  await P.waitForSelector('.ko[data-stage="9"]');
  k = await koInfo(P);
  ok('K2 erzwungen: Variante C mit Spruch Index 2', k?.v === 'C' && k.q === 2 && k.quote.includes(quotes[2]), JSON.stringify(k));
  ok('B1 C live: Mittelfeld „R1“, ohne Verursacher Balken leer', k?.cRound === 'R1' && k.segs === '0', JSON.stringify(k));
  ok('C ohne Verursacher: „K.O.“ ohne Siegerzeile', k?.wins === null && /K\.O\./.test(await P.textContent('.ko .ko-3d')), JSON.stringify(k));
  await P.shot('p11-03-live-C');
  await P.click('.ko [data-ko="ask"]');
  await P.waitForSelector('.sheet-wrap [data-sheet="ko"] [data-ko="by"]');
  ok('K3 „Wer war es?“ ⇒ Auswahl mit A, C und „Aufgegeben“',
    (await P.locator(`.sheet-wrap [data-ko="by"][data-by="${A}"]`).count()) === 1 && (await P.locator(`.sheet-wrap [data-ko="by"][data-by="${C}"]`).count()) === 1 && (await P.locator('.sheet-wrap [data-ko="gaveup"]').count()) === 1);
  await P.shot('p11-04-wer-war-es');
  await P.click(`.sheet-wrap [data-ko="by"][data-by="${A}"]`);
  await P.waitForFunction(() => !document.querySelector('.ko') && !document.querySelector('.sheet-wrap'));
  ok('K3 B durch A raus ⇒ Platz 3, keine Tippzonen', /Platz 3/.test(await P.textContent(`${field(B)} .lc-plaque`)) && !(await P.locator(`${field(B)} .lc-tap.minus`).isVisible()));
  ok('K3 Plakette nennt den Verursacher', /Franco Test/.test(await P.textContent(`${field(B)} .lc-plaque`)), await P.textContent(`${field(B)} .lc-plaque`));

  // ---------------------------------------------------------------- Kriterium 5: zweiter K.O. direkt danach
  await force(P, [0, 1, 1, 5]); // erster: A/1 · zweiter: B/5
  await tap(P, C, 20);
  await P.waitForSelector('.ko');
  await P.keyboard.press('Escape'); // noch während der Animation (Timer laufen)
  await P.waitForFunction(() => !document.querySelector('.ko'));
  await watchStages(P);
  await P.click(`${field(C)} [data-act="ko"]`);
  await P.waitForSelector('.ko[data-stage="9"]');
  await P.waitForTimeout(300);
  const st = await P.evaluate(() => window.__stages);
  k = await koInfo(P);
  const mono = st.map(Number).every((x, i, a) => i === 0 || x >= a[i - 1]);
  ok('K5 zweiter K.O. direkt nach dem Schließen läuft vollständig (0…9, nie rückwärts)', st[0] === '0' && st.at(-1) === '9' && mono && k?.v === 'B' && k.q === 5, `${st.join(',')} ${JSON.stringify(k)}`);
  ok('K5 genau ein .ko im DOM', (await P.locator('.ko').count()) === 1);
  await P.click('.ko [data-ko="cancel"]');
  await P.waitForTimeout(1000);
  ok('K5 nach Schließen + 1 s: kein .ko, keine Konsolenfehler', (await P.locator('.ko').count()) === 0 && P.errs.length === 0, P.errs.join(' | '));
  await abort(P);

  // ---------------------------------------------------------------- Kriterium 4: reduced-motion
  const g2 = await start();
  await P.emulateMedia({ reducedMotion: 'reduce' });
  await P.goto(BASE + '#/spiel/' + g2);
  await P.waitForSelector('.lc-field');
  await force(P, [0, 0]);
  await P.evaluate(() => {
    window.__rm = new Promise((res) => {
      let shook = false;
      const mo = new MutationObserver(() => {
        if (document.querySelector('.ko-shake')) shook = true;
        const r = document.querySelector('.ko');
        if (!r || window.__rmT0) return;
        window.__rmT0 = performance.now();
        const t0 = window.__rmT0;
        const vis = () => [...r.querySelectorAll('[data-ko="cancel"], [data-ko="ask"], [data-ko="out"]')]
          .every((b) => { const cs = getComputedStyle(b); const box = b.getBoundingClientRect(); return cs.visibility === 'visible' && box.height > 0 && Number(getComputedStyle(b.closest('.ko-sub')).opacity) === 1; });
        const check = () => {
          const dt = performance.now() - t0;
          if (vis()) { setTimeout(() => { mo.disconnect(); res({ dt, stage: r.dataset.stage, shook, flash: getComputedStyle(r).backgroundColor }); }, 900); return; }
          if (dt > 1000) { mo.disconnect(); res({ dt, stage: r.dataset.stage, shook, vis: false }); return; }
          setTimeout(check, 5);
        };
        check();
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    });
  });
  await tap(P, B, 20);
  const rm = await P.evaluate(() => window.__rm);
  ok('K4 reduced-motion: Knöpfe ≤ 100 ms nach dem Öffnen sichtbar (Stufe 9)', rm.dt <= 100 && rm.stage === '9' && rm.vis !== false, JSON.stringify(rm));
  ok('K4 reduced-motion: nie ein Element mit Wackel-Klasse, kein Blitz', rm.shook === false && rm.flash === 'rgba(0, 0, 0, 0)', JSON.stringify(rm));
  await P.shot('p11-05-reduced-motion');
  await P.click('.ko [data-ko="cancel"]');
  await P.emulateMedia({ reducedMotion: 'no-preference' });
  await abort(P);

  // ---------------------------------------------------------------- Negativraum: Komponente direkt (ohne Spiel)
  const iso = (opts, ms = 0) => P.evaluate(async ([o, wait]) => {
    const { showKo } = await import('/src/views/ko.js');
    window.__ev = [];
    window.__close = showKo(document.querySelector('#app') || document.body, { ...o, onEliminate: (b) => window.__ev.push(['e', b]), onCancel: () => window.__ev.push(['c']) });
    if (wait) await new Promise((r) => setTimeout(r, wait));
  }, [opts, ms]);
  const cands = [{ id: 'l', name: 'Luka', damage: 10, poison: 0, top: true }, { id: 't', name: 'Tim', damage: 0, poison: 0, top: false }];
  const noImg = { short_name: 'Krenko', commander_name: 'Krenko, Mob Boss', color_identity: ['R'], image_url: null };

  await iso({ player: { id: 'd', name: 'Deniz' }, deck: noImg, by: 'l', pick: { variant: 'B', quote: 1 }, candidates: cands });
  await P.waitForSelector('.ko[data-stage="9"]');
  ok('Ohne Commander-Bild: B-Karte mit Initialen, kein <image>', (await P.textContent('.ko [data-ko-initials]')).trim() === 'DE' && (await P.locator('.ko image').count()) === 0);
  ok('B mit Verursacher: Knopf heißt „Verbannen“', (await P.textContent('.ko [data-ko="out"]')).trim() === 'Verbannen');
  await P.dblclick('.ko [data-ko="out"]');
  await P.waitForTimeout(200);
  ok('Doppelklick auf „Verbannen“ ⇒ genau ein eliminate(by)', JSON.stringify(await P.evaluate(() => window.__ev)) === JSON.stringify([['e', 'l']]), JSON.stringify(await P.evaluate(() => window.__ev)));

  await iso({ player: { id: 'd', name: 'Deniz' }, deck: noImg, by: 'l', pick: { variant: 'C', quote: 3 }, candidates: cands });
  await P.waitForSelector('.ko[data-stage="9"]');
  ok('C mit Verursacher: „LUKA WINS“, Knopf „Ausscheiden“', /LUKA WINS/i.test(await P.textContent('.ko [data-ko-wins]')) && /Ausscheiden/i.test(await P.textContent('.ko [data-ko="out"]')));
  k = await koInfo(P);
  ok('Alter Aufrufer ohne round/life: C zeigt „VS“ und vollen Balken, kein Fehler', k?.cRound === 'VS' && k.segs === '10' && P.errs.length === 0, JSON.stringify(k));
  await P.click('.ko [data-ko="out"]');
  ok('„Ausscheiden“ mit bekanntem Verursacher ⇒ onEliminate(by)', JSON.stringify(await P.evaluate(() => window.__ev)) === JSON.stringify([['e', 'l']]));

  // Verlassen der View während der Animation ⇒ onCancel genau einmal, alles abgeräumt
  await iso({ player: { id: 'd', name: 'Deniz' }, deck: noImg, by: null, pick: { variant: 'A', quote: 1 }, candidates: cands }, 120);
  await P.evaluate(() => { location.hash = '#/historie'; });
  await P.waitForTimeout(1000);
  ok('View verlassen ⇒ onCancel genau einmal, kein .ko, keine Fehler',
    JSON.stringify(await P.evaluate(() => window.__ev)) === JSON.stringify([['c']]) && (await P.locator('.ko').count()) === 0 && P.errs.length === 0, JSON.stringify(await P.evaluate(() => window.__ev)) + P.errs.join(' | '));

  // Lange Namen (40 Zeichen) bei 375 × 667: Text bleibt im Bild, nichts läuft über
  await P.setViewportSize({ width: 375, height: 667 });
  for (const v of ['A', 'B', 'C']) {
    await iso({ player: { id: 'd', name: LONG }, deck: null, by: 'l', pick: { variant: v, quote: 4 }, candidates: [{ ...cands[0], name: LONG }] });
    await P.waitForSelector('.ko[data-stage="9"]');
    await P.waitForTimeout(400);
    const fit = await P.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const subs = [...document.querySelectorAll('.ko .ko-sub')].map((e) => e.getBoundingClientRect());
      const inView = subs.every((b) => b.left >= -1 && b.right <= vw + 1 && b.top >= 0 && b.bottom <= vh + 1);
      const spill = [...document.querySelectorAll('.ko .ko-sub *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0).map((e) => e.className || e.tagName);
      return { inView, spill, scroll: document.querySelector('.ko').scrollHeight <= vh };
    });
    ok(`Langer Name, 375 × 667, Variante ${v}: Panel + Knöpfe ganz im Bild, kein Überlauf`, fit.inView && fit.spill.length === 0 && fit.scroll, JSON.stringify(fit));
    await P.shot(`p11-06-lang-${v}`);
    await P.evaluate(() => window.__close());
  }
  await P.setViewportSize({ width: 390, height: 844 });

  ok('Keine JS-Fehler im K.O.-Lauf', P.errs.length === 0, P.errs.join(' | '));
  console.log('    HTTP-Fehler KO', JSON.stringify(P.bad));
  ok('Keine HTTP-Fehler im K.O.-Lauf', P.bad.length === 0, JSON.stringify(P.bad));
  await P.context().close();

  // ---------------------------------------------------------------- Kriterium 1: Bilder Stufe 4 + 9 neben der Mockup-Referenz
  const V = await ctx(browser, 'KOV');
  await V.clock.install();
  await V.goto(BASE + '#/login');
  await V.waitForSelector('#app');
  // Uhr anhalten: Timer laufen nur über runFor, CSS-Übergänge in Echtzeit
  await V.clock.pauseAt(await V.evaluate(() => Date.now() + 1000));
  const tymna = { short_name: 'Tymna', commander_name: 'Tymna the Weaver', partner_name: 'Thrasios, Triton Hero', color_identity: ['W', 'U', 'B', 'G'], image_url: null };
  const ref = { A: 'ko-a-anime', B: 'ko-b-reich-der-schatten', C: 'ko-c-arcade' };
  for (const v of ['A', 'B', 'C']) {
    await V.evaluate(async (o) => {
      const { showKo } = await import('/src/views/ko.js');
      window.__close = showKo(document.body, { ...o, onEliminate() {}, onCancel() {} });
    }, { player: { id: 'd', name: 'Deniz' }, deck: tymna, by: 'l', round: 7, life: { victim: -2, by: 24, start: 40 }, pick: { variant: v, quote: v === 'B' ? 1 : 3 }, candidates: [{ id: 'l', name: 'Luka', damage: 10, poison: 0, top: true }, { id: 't', name: 'Tim', damage: 0, poison: 0, top: false }, { id: 'j', name: 'Jo', damage: 0, poison: 0, top: false }] });
    await V.clock.runFor(340);
    await V.waitForTimeout(450); // CSS-Übergänge laufen in Echtzeit
    ok(`K1 Variante ${v}: Zwischenbild Stufe 4`, (await V.getAttribute('.ko', 'data-stage')) === '4');
    await V.shot(`p11-k1-${v}-stufe4`);
    await V.clock.runFor(500);
    await V.waitForTimeout(1600);
    ok(`K1 Variante ${v}: Stufe 9`, (await V.getAttribute('.ko', 'data-stage')) === '9');
    const kv = await koInfo(V);
    const want = { A: kv?.aLine === 'fällt in Runde 7 · durch Luka' && kv.tag === 'FINISH HIM!',
      B: kv?.bLine === 'Durch Luka · Runde 7 · Platz 4' && /^Runde 7 · Tymna/.test(kv.bCard ?? ''),
      C: kv?.cRound === 'R7' && kv.segs === '6' }; // 24 von 40 Leben ⇒ 6 von 10 Segmenten wie ko-c-arcade.html
    ok(`B1 Variante ${v}: Runde 7 im Text wie im Mockup${v === 'C' ? ', Lebensbalken anteilig' : ''}`, want[v], JSON.stringify(kv));
    await V.shot(`p11-k1-${v}-stufe9`);
    await V.evaluate(() => window.__close());
  }
  for (const v of ['A', 'B', 'C']) {
    await V.goto(BASE + `mockup/ko-varianten/${ref[v]}.html`);
    await V.waitForTimeout(800);
    await V.shot(`p11-k1-${v}-referenz`);
  }
  ok('Keine JS-Fehler im Bilder-Lauf', V.errs.length === 0, V.errs.join(' | '));
  await V.context().close();
}
