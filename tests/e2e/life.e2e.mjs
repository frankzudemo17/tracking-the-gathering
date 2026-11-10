// E2E Lifecounter (Spec P8, Kriterien 3–9 und Bilder zu 1).
// Läuft nach etappe1-2.e2e.mjs und VOR setup.e2e.mjs (alphabetisch) mit den Konten aus etappe1-2:
//   A = mail('a') „Franco Test“ (Admin, Deck Tymna + Thrasios) · B = „Luka Test“ · C = „Tim Echt“.
// Angemeldet ist A. Damit setup.e2e unverändert gilt, legt dieser Lauf KEINE Mitglieder/Decks an,
// ändert keine Feldfarbe und keine Pins und beendet jedes gestartete Spiel (gewertet bzw. verworfen).
// Spiele starten über den Store der App (gleicher Weg wie das Setup, RPC start_game), alle mit Tymna.
import { ok, ctx, hash, waitHash, login, mail } from './harness.mjs';

export default async function lifeE2e({ browser, base: BASE }) {
  console.log('\nLifecounter: Anmelden als A (Franco Test)');
  const P = await ctx(browser, 'L');
  await P.goto(BASE);
  await waitHash(P, '#/login');
  await login(P, mail('a'));
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
  const waitText = async (sel, re, ms = 10000) => {
    const end = Date.now() + ms; let v = '';
    do { v = (await P.locator(sel).first().textContent().catch(() => '')) || ''; if (re.test(v)) return v; await P.waitForTimeout(200); } while (Date.now() < end);
    return v;
  };

  // ---------------------------------------------------------------- Aufbau: Mitglieder + Deck
  const gid = await db('return state.groupId;');
  const mem = await db("const r = await sb.from('members').select('id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n)?.id;
  const A = byName('Franco Test'), B = byName('Luka Test'), C = byName('Tim Echt');
  ok('Gruppe hat A, B, C', !!(A && B && C), JSON.stringify(mem));
  const deck = await db("const q = await sb.from('decks').select('id, short_name, commander_name').ilike('commander_name', 'Tymna%').eq('archived', false).limit(1); return q.data?.[0];");
  ok('Deck Tymna vorhanden', !!deck?.id, JSON.stringify(deck));
  // Sitze 0..n-1 (start_game), A beginnt
  const start = (life, layout = 'seiten') => db(`return createStore(sb).startGame({ groupId: a.gid, layout: a.layout, startingLife: a.life, firstSeat: 0,
      players: a.ids.map((id, i) => ({ memberId: id, deckId: a.deck, seat: i })) });`, { gid, layout, life, ids: [A, B, C], deck: deck.id });
  const field = (id) => `.lc-field[data-pid="${id}"]`;
  const lifeOf = async (id) => Number((await P.textContent(`${field(id)} [data-life]`)).trim());
  const tap = async (id, sign, n = 1) => { for (let i = 0; i < n; i++) await P.click(`${field(id)} .lc-tap.${sign < 0 ? 'minus' : 'plus'}`); };
  const menu = async (tab) => {
    if (!(await P.locator('[data-sheet="menu"]').count())) { await P.click('.lc-hub'); await P.waitForSelector('[data-sheet="menu"]'); }
    if (tab) await P.click(`[data-sheet="menu"] [data-m="tab"][data-t="${tab}"]`);
  };
  const closeSheet = async () => { await P.keyboard.press('Escape'); await P.waitForFunction(() => !document.querySelector('.sheet-wrap')); };
  const savedEvents = (id) => db("const r = await sb.from('game_events').select('seq, type, payload').eq('game_id', a).order('seq'); return r.data;", id);

  // ---------------------------------------------------------------- Kriterium 3: kurzes Spiel
  const g1 = await start(20);
  ok('Spiel 1 gestartet', typeof g1 === 'string' && g1.length > 10, String(g1));
  await P.goto(BASE + '#/spiel/' + g1);
  await P.waitForSelector('.lc-field');
  ok('K1 Lifecounter: 3 Felder, Startleben 20', (await P.locator('.lc-field').count()) === 3 && (await lifeOf(A)) === 20);
  ok('Namen wie in der App (Profilname „Tim Echt“)', (await P.textContent(`${field(C)} .who b`)).trim() === 'Tim Echt', await P.textContent(`${field(C)} .who b`));
  ok('Am Zug: genau A mit „Zug beenden“', (await P.locator('.lc-field.turn').count()) === 1 && (await P.locator(`${field(A)}.turn [data-act="endturn"]`).count()) === 1);
  await P.shot('p8-01-start-3p');

  await tap(A, -1, 5);
  ok('K3 A −5 ⇒ 15, Delta −5', (await lifeOf(A)) === 15 && (await P.textContent(`${field(A)} .lc-delta`)).trim() === '−5');
  await P.click(`${field(B)} [data-act="counters"]`);
  await P.waitForSelector('[data-sheet="counters"]');
  for (let i = 0; i < 3; i++) await P.click('[data-sheet="counters"] .lc-ctr[data-key="poison"] [data-v="1"]');
  await P.shot('p8-02-zaehler');
  await closeSheet();
  ok('K3 B Gift 3 (Abzeichen)', /3/.test(await P.textContent(`${field(B)} [data-part="badges"]`)));
  await P.click(`${field(C)} [data-act="counters"]`);
  await P.click('[data-sheet="counters"] [data-c="flag"][data-k="monarch"]');
  await closeSheet();
  ok('K3 Monarch C', (await P.locator(`${field(C)} .lc-badge.monarch`).count()) === 1);
  await menu('log');
  await P.click('[data-sheet="menu"] [data-m="undo"]');
  ok('K3 Rückgängig ⇒ Monarch weg', (await P.locator(`${field(C)} .lc-badge.monarch`).count()) === 0);
  await menu('zug');
  for (let i = 0; i < 3; i++) await P.click('[data-sheet="menu"] [data-m="endturn"]');
  ok('K3 Zug beenden ×3 ⇒ Runde 2', (await P.textContent('.lc-hub [data-round]')).trim() === '2');
  await P.click('[data-sheet="menu"] [data-m="storm"][data-v="1"]');
  await P.click('[data-sheet="menu"] [data-m="storm"][data-v="1"]');
  ok('K3 Sturm 2', (await P.textContent('[data-storm]')).trim() === '2');
  await P.shot('p8-03-menu-zug');
  await P.click('[data-sheet="menu"] [data-m="endturn"]');
  ok('K3 Zug beenden ⇒ Sturm 0', (await P.textContent('[data-storm]')).trim() === '0');
  await menu('log');
  const logRows = await P.locator('.lc-logrow').allTextContents();
  ok('K3 Verlauf zeigt die Aktionen', logRows.length >= 6 && logRows.some((x) => x.includes('Gift')) && !logRows.some((x) => x.includes('Monarch')), JSON.stringify(logRows));
  await P.shot('p8-04-menu-verlauf');
  await menu('tools');
  ok('Live-Status „Gespeichert“', /Gespeichert/.test(await waitText('[data-live-text]', /Gespeichert/)));
  await P.shot('p8-05-menu-werkzeuge');
  const ev1 = await poll("const r = await sb.from('game_events').select('seq').eq('game_id', a); return r.data?.length;", g1, (n) => n === 16);
  const evs = await savedEvents(g1);
  const types = evs.map((e) => e.type);
  ok('K3 game_events seq 1..N lückenlos', evs.every((e, i) => e.seq === i + 1), `${ev1} · ${evs.map((e) => e.seq).join(',')}`);
  ok('K3 Typen: life×5, poison×3, flag, undo, turn_end×3, global×2, turn_end', JSON.stringify(types) === JSON.stringify(
    ['life', 'life', 'life', 'life', 'life', 'poison', 'poison', 'poison', 'flag', 'undo', 'turn_end', 'turn_end', 'turn_end', 'global', 'global', 'turn_end']), types.join(','));
  await closeSheet();

  // ---------------------------------------------------------------- Kriterium 4: Neuladen
  const before = await P.$$eval('.lc-field', (fs) => fs.map((f) => [f.dataset.pid, f.querySelector('[data-life]').textContent, f.classList.contains('turn'), f.querySelector('[data-part="badges"]').textContent.trim()]));
  await P.reload();
  await P.waitForSelector('.lc-field');
  await P.waitForTimeout(500);
  const after = await P.$$eval('.lc-field', (fs) => fs.map((f) => [f.dataset.pid, f.querySelector('[data-life]').textContent, f.classList.contains('turn'), f.querySelector('[data-part="badges"]').textContent.trim()]));
  ok('K4 Neuladen ⇒ gleiche Anzeige (Leben, Zug, Abzeichen, Runde)', JSON.stringify(before) === JSON.stringify(after) && (await P.textContent('.lc-hub [data-round]')).trim() === '2', JSON.stringify([before, after]));
  await menu('log');
  await P.click('[data-sheet="menu"] [data-m="undo"]');
  await menu('zug');
  ok('K4 Rückgängig nach Neuladen trifft den letzten Zugwechsel (A wieder am Zug, Sturm 2)',
    (await P.locator(`${field(A)}.turn`).count()) === 1 && (await P.textContent('[data-storm]')).trim() === '2');

  // ---------------------------------------------------------------- Kriterium 8: W20, reduzierte Bewegung
  await P.emulateMedia({ reducedMotion: 'reduce' });
  await menu('tools');
  await P.click('[data-sheet="menu"] [data-m="kind"][data-k="w20"]');
  await P.click('[data-sheet="menu"] [data-m="roll"]');
  const w20 = Number((await P.locator('[data-roll]').textContent({ timeout: 300 })).trim());
  ok('K8 W20 sofort (reduzierte Bewegung) und 1..20', w20 >= 1 && w20 <= 20, String(w20));
  await P.emulateMedia({ reducedMotion: 'no-preference' });
  const roll = await poll("const r = await sb.from('game_events').select('payload').eq('game_id', a).eq('type', 'roll'); return r.data;", g1, (r) => r?.length === 1);
  ok('K8 roll-Event mit payload.kind w20 und Wert', roll?.[0]?.payload?.kind === 'w20' && roll[0].payload.values?.[0] === w20, JSON.stringify(roll));
  ok('Live-Status wieder „Gespeichert“', /Gespeichert/.test(await waitText('[data-live-text]', /Gespeichert/)));
  await closeSheet();

  // ---------------------------------------------------------------- Kriterium 9: offline
  await P.context().setOffline(true);
  await tap(C, -1, 2);
  await menu('tools');
  const off = await waitText('[data-live-text]', /Offline.*\(2\)/, 4000);
  ok('K9 Offline + 2 Taps ⇒ „Offline – wird nachgeholt (2)“', /Offline – wird nachgeholt \(2\)/.test(off), off);
  await P.shot('p8-06-offline');
  await P.context().setOffline(false);
  const on = await waitText('[data-live-text]', /Gespeichert/, 15000);
  ok('K9 wieder online ⇒ „Gespeichert“', /Gespeichert/.test(on), on);
  await closeSheet();

  // ---------------------------------------------------------------- Kriterium 7: Anzeigetafel
  const ls = await poll("const r = await sb.from('games').select('live_state').eq('id', a).single(); return r.data?.live_state;", g1,
    (v) => v?.players?.find((p) => p.id === C)?.life === 18, 12000);
  await menu();
  await P.click('[data-sheet="menu"] [data-m="home"]');
  await waitHash(P, '#/start');
  await P.waitForSelector(`[data-live-game="${g1}"]`);
  const tiles = await P.$$eval(`[data-live-game="${g1}"] .lc-tile`, (ts) => ts.map((t) => [t.dataset.tile, Number(t.querySelector('[data-life]').textContent)]));
  const lsLives = (ls?.players || []).map((p) => [p.id, p.life]);
  const sortById = (xs) => xs.slice().sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  ok('K7 Anzeigetafel: 3 Kacheln, Leben wie live_state', tiles.length === 3 && JSON.stringify(sortById(tiles)) === JSON.stringify(sortById(lsLives)), JSON.stringify([tiles, lsLives]));
  const tl = Object.fromEntries(tiles);
  ok('K7 Leben stimmen mit dem Spiel (A 15, B 20, C 18, auch nach Offline-Phase)', tl[A] === 15 && tl[B] === 20 && tl[C] === 18, JSON.stringify(tiles));
  await P.shot('p8-07-anzeigetafel');
  await P.click(`[data-live-game="${g1}"]`);
  await waitHash(P, '#/spiel/' + g1);
  ok('K7 Tippen auf die Karte ⇒ /spiel/<id>', hash(P) === '#/spiel/' + g1);
  await P.waitForSelector('.lc-field');

  // ---------------------------------------------------------------- Kriterium 5: K.O.-Ablauf
  await tap(B, -1, 20);
  await P.waitForSelector('[data-sheet="ko"]');
  ok('K5 B auf 0 ⇒ K.O.-Sheet mit „Wer war es?“', (await P.locator('[data-sheet="ko"] [data-ko="ask"]').count()) === 1);
  await P.shot('p8-08-ko');
  await P.click('[data-sheet="ko"] [data-ko="cancel"]');
  await P.waitForSelector(`${field(B)} [data-act="ko"]`);
  ok('K5 „Doch nicht“ ⇒ Feld zeigt „Ausgeschieden?“', (await P.textContent(`${field(B)} [data-act="ko"]`)).includes('Ausgeschieden?'));
  await P.click(`${field(A)} .lc-tap.minus`);
  ok('Tippen auf andere Felder geht weiter (A 14)', (await lifeOf(A)) === 14);
  await P.click(`${field(B)} [data-act="ko"]`);
  await P.click('[data-sheet="ko"] [data-ko="ask"]');
  await P.shot('p8-09-ko-wer');
  await P.click('[data-sheet="ko"] [data-ko="gaveup"]');
  await P.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  ok('K5 „Aufgegeben“ ⇒ B Platz 3, keine Tippzonen', /Platz 3/.test(await P.textContent(`${field(B)} .lc-plaque`)) && !(await P.locator(`${field(B)} .lc-tap.minus`).isVisible()));
  await P.click(`${field(C)} [data-act="counters"]`);
  await P.click('[data-sheet="counters"] [data-c="out"]');
  await P.waitForSelector('[data-sheet="ko"]');
  await P.click('[data-sheet="ko"] [data-ko="ask"]');
  const top = await P.locator('[data-sheet="ko"] [data-ko="by"]').count();
  ok('K5 „Wer war es?“ ohne Ausgeschiedene (nur A)', top === 1, String(top));
  await P.click(`[data-sheet="ko"] [data-ko="by"][data-by="${A}"]`);
  await P.waitForSelector('[data-sheet="end"]');
  ok('K5 C durch A ⇒ A Platz 1, Spiel entschieden', /Platz 1/.test(await P.textContent(`${field(A)} .lc-plaque`)) && /Platz 2/.test(await P.textContent(`${field(C)} .lc-plaque`)));
  await P.shot('p8-10-entschieden');

  // ---------------------------------------------------------------- Kriterium 6: werten
  await P.click('[data-sheet="end"] [data-e="finished"]');
  await waitHash(P, '#/start');
  const fin = await poll("const g = await sb.from('games').select('status').eq('id', a).single(); const p = await sb.from('game_players').select('member_id, place, eliminated_by').eq('game_id', a); return { st: g.data?.status, p: p.data };", g1, (v) => v?.st === 'finished');
  const place = Object.fromEntries((fin?.p || []).map((x) => [x.member_id, x.place]));
  ok('K6 „Werten und beenden“ ⇒ finished, Plätze A1 · C2 · B3', fin?.st === 'finished' && place[A] === 1 && place[C] === 2 && place[B] === 3, JSON.stringify(fin));
  ok('K6 C durch A ausgeschieden (eliminated_by)', fin?.p?.find((x) => x.member_id === C)?.eliminated_by === A);
  await P.waitForSelector('.art-hero');
  ok('K7 Karte nach Spielende weg', (await P.locator(`[data-live-game="${g1}"]`).count()) === 0);

  // ---------------------------------------------------------------- Kriterium 6: verwerfen
  const g2 = await start(40, 'rundum');
  await P.goto(BASE + '#/spiel/' + g2);
  await P.waitForSelector('.lc-field');
  await tap(B, 1, 1);
  await P.shot('p8-11-rundum');
  await menu();
  await P.click('[data-sheet="menu"] [data-m="end"]');
  await P.waitForSelector('[data-sheet="end"]');
  await P.shot('p8-12-beenden');
  await P.click('[data-sheet="end"] [data-e="aborted"]');
  await waitHash(P, '#/start');
  const ab = await poll("const g = await sb.from('games').select('status').eq('id', a).single(); const v = await sb.from('v_game_results').select('game_id').eq('game_id', a); return { st: g.data?.status, n: v.data?.length };", g2, (v) => v?.st === 'aborted');
  ok('K6 „Verwerfen“ ⇒ aborted, nicht in v_game_results', ab?.st === 'aborted' && ab?.n === 0, JSON.stringify(ab));
  const vr = await db("const v = await sb.from('v_game_results').select('game_id').eq('game_id', a); return v.data?.length;", g1);
  ok('K6 gewertetes Spiel steht in v_game_results (3 Zeilen)', vr === 3, String(vr));

  // ---------------------------------------------------------------- beendetes Spiel direkt öffnen
  await P.goto(BASE + '#/spiel/' + g1);
  await P.waitForSelector('.empty');
  ok('Beendetes Spiel ⇒ „Spiel ist beendet“ + Link zur Startseite', (await P.textContent('.empty b')).includes('beendet') && (await P.locator('a.btn[href="#/start"]').count()) === 1);

  ok('Keine JS-Fehler im Lifecounter-Lauf', P.errs.length === 0, P.errs.join(' | '));
  console.log('    HTTP-Fehler L', JSON.stringify(P.bad));
  ok('Keine HTTP-Fehler im Lifecounter-Lauf', P.bad.length === 0, JSON.stringify(P.bad));
  await P.context().close();
}
