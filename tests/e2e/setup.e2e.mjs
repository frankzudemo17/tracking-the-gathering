// E2E Setup „Neues Spiel“ (Spec P7, Kriterien 1–6 und 8).
// Läuft nach etappe1-2.e2e.mjs im selben Lauf und nutzt dessen Konten (Harness: höchstens 3 je Lauf):
//   A = 'a' „Franco Test“ (Admin, Deck Tymna + Thrasios) · B = 'b' „Luka Test“ (ohne Deck)
//   C = 'c' „Tim Echt“ (ohne Deck), alle in „Küchentisch <b>Test</b>“.
// Angemeldet ist B. Datenbank-Abfragen laufen im Browser über den Supabase-Client der App
// (gleiche Sitzung, RLS greift) — also „als Testkonto“.
// P9b: feste Testkonten (login(page, 'a'|'b'|'c')) in TTG-E2E-Fixture; run.mjs stellt vorher den Grundzustand her,
// prepare() den Stand, den die alte Kette hier hinterließ (nach etappe1-2: A (Tymna + Thrasios, Bracket 2), B und C ohne Deck; Krenko und Jo legt diese Datei selbst an).
import { ok, ctx, hash, waitHash, login, prepare } from './harness.mjs';

export default async function setupE2e({ browser, base: BASE }) {
  await prepare({ members: ['b', 'c'], decks: [['a', 'tymna']] });
  console.log('\nSetup: Anmelden als B (Luka Test)');
  const S = await ctx(browser, 'S');
  await S.goto(BASE);
  await waitHash(S, '#/login');
  await login(S, 'b');
  await waitHash(S, '#/start');
  ok('B angemeldet (Konto aus etappe1-2)', true);

  const db = (fn, arg) => S.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'a', `return (async () => { ${src} })()`)(sb, state, a);
  }, [fn, arg]);
  const poll = async (fn, arg, pred, ms = 10000) => {
    const end = Date.now() + ms; let v;
    do { v = await db(fn, arg); if (pred(v)) return v; await S.waitForTimeout(300); } while (Date.now() < end);
    return v;
  };

  // ---------------------------------------------------------------- Kriterium 8a
  await S.goto(BASE + '#/spielen');
  await S.waitForSelector('.su-row');
  ok('K8 /spielen zeigt seit P8 das Setup (Nav „Spielen“)', (await S.locator('[data-act="member"]').count()) >= 3 && (await S.locator('.empty b').count()) === 0);

  // ---------------------------------------------------------------- Negativraum: kaputter/abgelaufener Entwurf
  const gid0 = await db('return state.groupId;');
  await S.evaluate((g) => sessionStorage.setItem('ttg.setup.' + g, '{kaputt'), gid0);
  await S.goto(BASE + '#/spiel-neu');
  await S.waitForSelector('.su-row');
  ok('Kaputter Entwurf ⇒ leeres Setup ohne Fehler', S.errs.length === 0 && (await S.locator('[data-act="member"][aria-pressed="true"]').count()) === 1, S.errs.join(' | '));
  await S.evaluate((g) => sessionStorage.setItem('ttg.setup.' + g, JSON.stringify({ sel: ['gibt-es-nicht'], deck: { x: 'y' }, layout: 'quatsch', life: -3 })), gid0);
  await S.reload();
  await S.waitForSelector('.su-row');
  ok('Ungültiger Entwurf ⇒ bereinigt (eigenes Mitglied, Startleben 40)', (await S.locator('[data-act="member"][aria-pressed="true"]').count()) === 1
    && (await S.textContent('.su-lifebig')).trim() === '40', await S.textContent('.su-lifebig'));
  const ids = Object.fromEntries(await S.$$eval('[data-act="member"]', (bs) => bs.map((b) => [b.querySelector('span').textContent.trim(), b.dataset.id])));
  const A = ids['Franco Test'], B = ids['Luka Test'], C = ids['Tim Echt'];
  ok('Setup listet A, B, C', !!(A && B && C), JSON.stringify(ids));
  ok('Eigenes Mitglied vorausgewählt', (await S.getAttribute(`[data-act="member"][data-id="${B}"]`, 'aria-pressed')) === 'true');
  await S.click(`[data-act="member"][data-id="${A}"]`);
  await S.click(`[data-act="member"][data-id="${C}"]`);
  await S.shot('setup-01-drei-spieler');

  await S.setViewportSize({ width: 375, height: 812 });
  await S.waitForTimeout(300);
  const sw375 = await S.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  ok('375 px: kein waagrechtes Scrollen', sw375[0] <= sw375[1], JSON.stringify(sw375));
  await S.setViewportSize({ width: 390, height: 844 });

  // ---------------------------------------------------------------- Kriterium 2
  const startBtn = '[data-act="start"]';
  ok('K2 Zwei ohne Deck ⇒ Start gesperrt', await S.isDisabled(startBtn));
  ok('K2 Grund sichtbar (2 Spieler)', (await S.textContent('[data-why]')).includes('2 Spieler brauchen noch ein Deck'), await S.textContent('[data-why]'));
  ok('K2 „+ Commander“ nur für eigenes Konto/Platzhalter', (await S.locator(`.su-row[data-mid="${B}"] .su-addcmd`).count()) === 1
    && (await S.locator(`.su-row[data-mid="${C}"] .su-addcmd`).count()) === 0);
  await S.click(`.su-row[data-mid="${C}"] [data-act="cycle"]`); // Tim leiht ein Deck
  ok('K2 Leihdeck für C gewählt (Deck von A)', (await S.textContent(`.su-row[data-mid="${C}"] .su-deckbtn`)).includes('Tymna'));
  ok('K2 Einer ohne Deck ⇒ weiter gesperrt', await S.isDisabled(startBtn));
  ok('K2 Grundtext nennt Luka', (await S.textContent('[data-why]')).includes('Luka Test braucht noch ein Deck'), await S.textContent('[data-why]'));
  await S.shot('setup-02-sperre');

  // ---------------------------------------------------------------- Kriterium 5 (Umweg)
  await S.click('[data-act="layout"][data-l="rundum"]');
  await S.click('[data-act="lifeset"][data-v="30"]');
  await S.click(`.su-row[data-mid="${B}"] .su-addcmd`);
  await waitHash(S, '#/deck-neu/');
  ok('K5 „+ Commander“ ⇒ Deck anlegen mit zurueck=setup', hash(S).includes('zurueck=setup'));
  await S.fill('#ad-q', 'krenko');
  await S.waitForSelector('.result >> text=Krenko, Mob Boss', { timeout: 20000 });
  await S.click('.result >> text=Krenko, Mob Boss');
  await S.click('[data-act="save"]');
  await waitHash(S, '#/spiel-neu');
  await S.waitForSelector(`.su-row[data-mid="${B}"] .su-deckbtn`);
  ok('K5 zurück im Setup, neues Deck ausgewählt', (await S.textContent(`.su-row[data-mid="${B}"] .su-deckbtn`)).includes('Krenko'));
  ok('K5 Spieler erhalten', (await S.locator('[data-act="member"][aria-pressed="true"]').count()) === 3);
  ok('K5 Tischvorlage erhalten', (await S.getAttribute('[data-act="layout"][data-l="rundum"]', 'aria-pressed')) === 'true');
  ok('K5 Startleben erhalten', (await S.textContent('.su-lifebig')).trim() === '30');
  ok('K5 Leihdeck von C erhalten', (await S.textContent(`.su-row[data-mid="${C}"] .su-deckbtn`)).includes('Tymna'));
  ok('K2 Alle mit Deck ⇒ Start aktiv', !(await S.isDisabled(startBtn)) && (await S.locator('[data-why]').count()) === 0);
  await S.shot('setup-03-nach-umweg');
  // Umweg „+ Spieler“: neuer Spieler ohne Konto ist danach vorausgewählt
  await S.click('a[href^="#/spieler-neu"]');
  await waitHash(S, '#/spieler-neu');
  await S.fill('#ap-name', 'Jo Test');
  await S.click('button[type=submit]');
  await waitHash(S, '#/spiel-neu');
  await S.waitForSelector('.su-row');
  const jo = await S.getAttribute('[data-act="member"]:has-text("Jo Test")', 'data-id');
  ok('K5 „+ Spieler“ ⇒ neuer Spieler vorausgewählt, Rest erhalten', (await S.getAttribute(`[data-act="member"][data-id="${jo}"]`, 'aria-pressed')) === 'true'
    && (await S.locator('[data-act="member"][aria-pressed="true"]').count()) === 4 && (await S.textContent('.su-lifebig')).trim() === '30');
  await S.click(`[data-act="member"][data-id="${jo}"]`); // wieder abwählen

  // ---------------------------------------------------------------- Kriterium 6 (Feldfarbe auf fremdem Deck)
  const tymna = await db("const r = await sb.from('decks').select('id, owner_profile_id').ilike('commander_name', 'Tymna%'); if (r.error) throw r.error; return r.data[0]?.id;");
  const myUid = await db('return state.session.user.id;');
  const deckOwner = await db("const r = await sb.from('decks').select('owner_profile_id').eq('id', a).single(); return r.data.owner_profile_id;", tymna);
  ok('K6 Deck gehört einem anderen Konto', !!tymna && deckOwner !== myUid);
  await S.click(`[data-act="color"][data-mid="${A}"]`);
  await S.waitForSelector('.su-preview');
  await S.click('.su-palette [data-c="#2D6DB5"]');
  await S.waitForSelector('.su-palette [data-c="#2D6DB5"][aria-pressed="true"]');
  const blue = await poll("const r = await sb.from('decks').select('field_color, field_mode').eq('id', a).single(); return r.data;", tymna, (d) => d?.field_color === '#2D6DB5');
  ok("K6 Blau ⇒ decks.field_color = '#2D6DB5'", blue?.field_color === '#2D6DB5' && blue?.field_mode === 'color', JSON.stringify(blue));
  await S.shot('setup-04-feldfarbe-blau');
  await S.click('.su-opt[data-mode="commander"]');
  const cmd = await poll("const r = await sb.from('decks').select('field_color, field_mode').eq('id', a).single(); return r.data;", tymna, (d) => d?.field_color === null);
  ok('K6 Commander-Farben ⇒ field_color null', cmd?.field_color === null && cmd?.field_mode === 'commander', JSON.stringify(cmd));
  await S.click('.su-palette [data-c="#2D6DB5"]');
  await poll("const r = await sb.from('decks').select('field_color').eq('id', a).single(); return r.data;", tymna, (d) => d?.field_color === '#2D6DB5');
  await S.click('[data-act="done"]');
  await S.waitForSelector('.sheet-wrap', { state: 'detached' });
  const sw = await S.$eval(`.su-row[data-mid="${A}"] .su-swatch`, (e) => getComputedStyle(e).backgroundColor);
  ok('Neue Feldfarbe im Deckchip gerendert', sw === 'rgb(45, 109, 181)', sw);

  // ---------------------------------------------------------------- Kriterium 1 (Bild je Look)
  for (const look of ['nacht', 'arktis', 'lachs']) {
    await S.goto(BASE + '#/einstellungen'); await S.waitForSelector('[data-look]');
    await S.click(`[data-look="${look}"]`);
    await S.waitForFunction((l) => document.documentElement.dataset.theme === l, look);
    await S.goto(BASE + '#/spiel-neu'); await S.waitForSelector('.su-row'); await S.waitForTimeout(1200);
    await S.shot(`setup-K1-${look}`);
    await S.click(`[data-act="color"][data-mid="${A}"]`); await S.waitForSelector('.su-preview'); await S.waitForTimeout(600);
    await S.shot(`setup-K1-feldfarbe-${look}`);
    await S.click('[data-act="done"]');
    ok(`K1 Setup im Look ${look} gerendert (Entwurf erhalten)`, (await S.locator('[data-act="member"][aria-pressed="true"]').count()) === 3);
  }
  await S.goto(BASE + '#/einstellungen'); await S.waitForSelector('[data-look]'); await S.click('[data-look="nacht"]');
  await S.goto(BASE + '#/spiel-neu'); await S.waitForSelector('.su-row');

  // ---------------------------------------------------------------- Kriterien 3 + 4
  const order0 = await S.$$eval('.su-row', (rs) => rs.map((r) => r.dataset.mid));
  await S.click('[data-act="swap"][data-i="0"]');
  await S.click('[data-act="swap"][data-i="1"]');
  const order = await S.$$eval('.su-row', (rs) => rs.map((r) => r.dataset.mid));
  ok('Zwei Plätze antippen tauscht sie', order[0] === order0[1] && order[1] === order0[0] && order[2] === order0[2], JSON.stringify([order0, order]));
  await S.evaluate(() => { const q = [1, 6, 2].map((w) => (w - 1) / 2 ** 32); window.__ttgRand = () => (q.length ? q.shift() : 0.5); });
  await S.click('[data-act="roll"]'); // öffnet seit P9 den Würfeltisch
  await S.click('.dt-felt');
  await S.waitForSelector('[data-dice="accept"]:not([hidden])', { timeout: 10000 });
  await S.click('[data-dice="accept"]');
  await S.waitForSelector('.dt', { state: 'detached' });
  const starter = (await S.textContent('.su-startrow b')).trim();
  const firstSeat = order.findIndex((id) => starter.startsWith(Object.entries(ids).find(([, v]) => v === id)?.[0] ?? '§'));
  ok('Auswürfeln (Testhaken) setzt Startspieler', firstSeat >= 0, starter);
  const deckOf = Object.fromEntries(await S.$$eval('.su-row', (rs) => rs.map((r) => [r.dataset.mid, r.querySelector('.su-deckbtn .t span')?.textContent])));
  const gid = await db('return state.groupId;');
  const before = await db("const r = await sb.from('games').select('id').eq('playgroup_id', a); return r.data.length;", gid);
  await S.dblclick(startBtn);
  await waitHash(S, '#/spiel/');
  const gameId = hash(S).split('/')[2];
  await S.waitForTimeout(1500);
  const after = await db("const r = await sb.from('games').select('id').eq('playgroup_id', a); return r.data.length;", gid);
  ok('K3 Doppelklick ⇒ genau 1 neues Spiel', after - before === 1, `${before} → ${after}`);
  const g = await db("const r = await sb.from('games').select('layout, starting_life, first_seat, status').eq('id', a).single(); return r.data;", gameId);
  ok('K4 games: layout rundum, Startleben 30, Startsitz, live', g?.layout === 'rundum' && g?.starting_life === 30 && g?.first_seat === firstSeat && g?.status === 'live', JSON.stringify(g));
  const gp = await db("const r = await sb.from('game_players').select('member_id, deck_id, seat, decks(short_name)').eq('game_id', a).order('seat'); return r.data;", gameId);
  ok('K4 game_players: Sitze nach Tausch', JSON.stringify(gp?.map((x) => x.member_id)) === JSON.stringify(order), JSON.stringify(gp));
  ok('K4 game_players: Decks wie gewählt', gp?.every((x) => x.decks?.short_name === deckOf[x.member_id]), JSON.stringify([gp?.map((x) => x.decks?.short_name), deckOf]));
  ok('Ein Deck bei zwei Spielern erlaubt (A und C mit Tymna)', gp?.filter((x) => x.decks?.short_name?.includes('Tymna')).length === 2);

  // ---------------------------------------------------------------- Kriterium 8b
  await S.waitForSelector('.lc-field');
  ok('K8 /spiel/<id> zeigt den Lifecounter mit 3 Feldern', (await S.locator('.lc-field').count()) === 3);
  await S.shot('setup-05-lifecounter');
  await S.click('.lc-hub');
  await S.click('[data-sheet="menu"] [data-m="end"]');
  await S.click('[data-sheet="end"] [data-e="aborted"]');
  await waitHash(S, '#/start');
  const st = await poll("const r = await sb.from('games').select('status').eq('id', a).single(); return r.data?.status;", gameId, (v) => v === 'aborted');
  ok('K8 „Spiel verwerfen“ ⇒ Spiel aborted, zurück zum Start', st === 'aborted', st);

  ok('Keine JS-Fehler im Setup-Lauf', S.errs.length === 0, S.errs.join(' | '));
  console.log('    HTTP-Fehler S', JSON.stringify(S.bad));
  ok('Keine HTTP-Fehler im Setup-Lauf', S.bad.length === 0, JSON.stringify(S.bad));
}
