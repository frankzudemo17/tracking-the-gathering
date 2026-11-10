// E2E Spielende: Ergebnis-Screen + Bewerten (Spec P20, Kriterien 1, 4, 7, 9; Bilder 375 px).
// Läuft alphabetisch NACH setup.e2e.mjs (und spiel-angriff.e2e.mjs) mit den Konten/Mitgliedern des Laufs:
//   A = mail('a') „Franco Test“ (Deck Tymna) · B = mail('b') „Luka Test“ (Deck Krenko aus setup.e2e)
//   Jo = Platzhalter „Jo Test“ (aus setup.e2e, leiht Krenko). Legt KEIN Konto, KEIN Mitglied, KEIN Deck an.
// Dateiname statt spec „ende.e2e.mjs“: „ende“ liefe alphabetisch vor etappe1-2 (keine Konten, keine Decks).
// Das Spiel startet über den Store der App (RPC start_game, wie life.e2e), endet über „Werten und beenden“.
// Das Testfoto wird am Ende entfernt (der Harness räumt Spiele/Gruppe, aber keine game-photos-Objekte).
import { ok, ctx, waitHash, login, mail, testImage } from './harness.mjs';

export default async function spielEndeE2e({ browser, base: BASE }) {
  console.log('\nSpielende: Anmelden als A (Franco Test)');
  const P = await ctx(browser, 'E');
  await P.setViewportSize({ width: 375, height: 812 });
  await P.goto(BASE);
  await waitHash(P, '#/login');
  await login(P, mail('a'));
  await waitHash(P, '#/start');
  ok('A angemeldet', true);

  const dbOn = (page) => (fn, arg) => page.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    const { createStore } = await import('/src/lib/game-store.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'createStore', 'a', `return (async () => { ${src} })()`)(sb, state, createStore, a);
  }, [fn, arg]);
  const db = dbOn(P);
  const pollOn = (dbf, page) => async (fn, arg, pred, ms = 10000) => {
    const end = Date.now() + ms; let v;
    do { v = await dbf(fn, arg); if (pred(v)) return v; await page.waitForTimeout(300); } while (Date.now() < end);
    return v;
  };
  const poll = pollOn(db, P);
  const toastIs = (page, re, ms = 8000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout: ms }).then(() => true, () => false);

  // ---------------------------------------------------------------- Aufbau
  const gid = await db('return state.groupId;');
  const mem = await db("const r = await sb.from('members').select('id, profile_id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n);
  const A = byName('Franco Test')?.id, B = byName('Luka Test')?.id, J = byName('Jo Test');
  ok('Gruppe hat A, B und Platzhalter Jo', !!(A && B && J?.id && J.profile_id == null), JSON.stringify(mem));
  const deck = (q) => db("const r = await sb.from('decks').select('id, short_name, commander_name').ilike('commander_name', a).eq('archived', false).limit(1); return r.data?.[0];", q);
  const tymna = await deck('Tymna%'), krenko = await deck('Krenko%');
  ok('Decks Tymna (A) und Krenko (B) vorhanden', !!(tymna?.id && krenko?.id), JSON.stringify([tymna, krenko]));
  const g = await db(`return createStore(sb).startGame({ groupId: a.gid, layout: 'seiten', startingLife: 20, firstSeat: 0,
      players: [{ memberId: a.A, deckId: a.t, seat: 0 }, { memberId: a.B, deckId: a.k, seat: 1 }, { memberId: a.J, deckId: a.k, seat: 2 }] });`,
  { gid, A, B, J: J.id, t: tymna.id, k: krenko.id });
  ok('Spiel A + B + Platzhalter gestartet', typeof g === 'string' && g.length > 10, String(g));

  // ---------------------------------------------------------------- Kriterium 1: „Werten und beenden“ ⇒ #/spiel/<id>/ende
  await P.goto(BASE + '#/spiel/' + g);
  await P.waitForSelector('.lc-field');
  const tap = async (id, n) => { for (let i = 0; i < n; i++) await P.click(`.lc-field[data-pid="${id}"] .lc-tap.minus`); };
  await tap(B, 3);
  await tap(J.id, 5);
  await P.waitForTimeout(800);
  await P.click('.lc-hub');
  await P.click('[data-sheet="menu"] [data-m="end"]');
  await P.waitForSelector('[data-sheet="end"]');
  await P.click('[data-sheet="end"] [data-e="finished"]');
  await waitHash(P, `#/spiel/${g}/ende`);
  ok('K1 „Werten und beenden“ ⇒ #/spiel/<id>/ende', P.url().endsWith(`#/spiel/${g}/ende`), P.url());
  const fin = await poll("const r = await sb.from('game_players').select('member_id, place').eq('game_id', a); const s = await sb.from('games').select('status').eq('id', a).single(); return { st: s.data?.status, p: r.data };", g, (v) => v?.st === 'finished');
  const place = Object.fromEntries((fin?.p || []).map((x) => [x.member_id, x.place]));
  ok('Spiel finished, Plätze A1 · B2 · Jo3 (nach Leben)', fin?.st === 'finished' && place[A] === 1 && place[B] === 2 && place[J.id] === 3, JSON.stringify(fin));

  // ---------------------------------------------------------------- Kriterium 4: A bewertet
  await P.waitForSelector('.rs-hero');
  ok('Ergebnis: „Franco Test gewinnt“, 3 Platzierungen', /Franco Test gewinnt/.test(await P.textContent('.rs-hero h2')) && (await P.locator('.rs-place').count()) === 3);
  ok('Deck-Salz nur für Krenko (eigenes Deck Tymna fehlt, Krenko einmal trotz B + Jo)', (await P.locator('[data-ds]').count()) === 1 && (await P.locator(`[data-ds="${krenko.id}"]`).count()) === 1);
  ok('POTG wählbar: A, B und Platzhalter Jo', (await P.locator('[data-pick="potg"]').count()) === 3 && (await P.locator(`[data-pick="potg"][data-v="${J.id}"]`).count()) === 1);
  await P.shot('p20-01-ergebnis-leer');
  await P.click('[data-pick="salt"][data-v="3"]');
  await P.click('[data-pick="fun"][data-v="4"]');
  await P.click('[data-pick="deckRating"][data-v="5"]');
  await P.click(`[data-pick="dsalt"][data-deck="${krenko.id}"][data-v="4"]`);
  await P.click(`[data-pick="potg"][data-v="${B}"]`);
  await P.fill('#rs-potg-text', '  Krenko-Kette in Runde 3  ');
  await P.click('[data-pick="wincon"][data-v="kampfschaden"]');
  await P.fill('#rs-note', 'E2E Notiz P20');
  await P.setInputFiles('[data-photo] input[data-file]:not([capture])', await testImage(browser));
  await P.waitForSelector('.rs-photo-img[src^="blob:"]');
  await P.shot('p20-02-ergebnis-ausgefuellt');
  await P.click('[data-act="save"]');
  await waitHash(P, `#/partie/${g}`);
  ok('Speichern ⇒ Toast „Gespeichert“ ⇒ #/partie/<id>', (await toastIs(P, /^Gespeichert$/)) && P.url().endsWith(`#/partie/${g}`));
  const REST = `const q = (t, c) => sb.from(t).select(c).eq('game_id', a);
    const [pr, ds, pv, gm] = await Promise.all([q('player_ratings', 'member_id, salt, fun, deck_rating'), q('deck_salt_ratings', 'rater_id, deck_id, salt'),
      q('potg_votes', 'voter_id, voted_for, text'), sb.from('games').select('wincon, note, photo_path, playgroup_id').eq('id', a).single()]);
    return { pr: pr.data, ds: ds.data, pv: pv.data, gm: gm.data };`;
  const r1 = await poll(REST, g, (v) => v?.pr?.length === 1 && v?.gm?.photo_path);
  ok('K4 REST als A: player_ratings 1 Zeile (3/4/5)', r1?.pr?.length === 1 && r1.pr[0].member_id === A && r1.pr[0].salt === 3 && r1.pr[0].fun === 4 && r1.pr[0].deck_rating === 5, JSON.stringify(r1?.pr));
  ok('K4 deck_salt_ratings 1 (Krenko 4)', r1?.ds?.length === 1 && r1.ds[0].deck_id === krenko.id && r1.ds[0].salt === 4, JSON.stringify(r1?.ds));
  ok('K4 potg_votes 1 (B, Text getrimmt)', r1?.pv?.length === 1 && r1.pv[0].voted_for === B && r1.pv[0].text === 'Krenko-Kette in Runde 3', JSON.stringify(r1?.pv));
  const photo = `${gid}/${g}.jpg`;
  ok('K4 games.wincon/note/photo_path gesetzt', r1?.gm?.wincon === 'kampfschaden' && r1.gm.note === 'E2E Notiz P20' && r1.gm.photo_path === photo, JSON.stringify(r1?.gm));
  await P.waitForSelector('.gd-hero');
  ok('Spieldetail zeigt Notiz, Foto und „Bewerten“', /E2E Notiz P20/.test(await P.textContent('#view')) && (await P.locator(`a.btn[href="#/spiel/${g}/ende"]`).count()) === 1);
  await P.shot('p20-03-spieldetail');
  // Metadaten statt Download (Download kann aus dem Zwischenspeicher kommen)
  const META = "const r = await sb.storage.from('game-photos').list(a.dir, { search: a.name }); const o = (r.data || []).find((x) => x.name === a.name); return o ? { size: o.metadata?.size ?? -1, at: o.updated_at, etag: o.metadata?.eTag } : null;";
  const metaArg = { dir: gid, name: `${g}.jpg` };
  const meta1 = await db(META, metaArg);
  const size1 = meta1?.size ?? -1;
  const img = await P.evaluate(async () => {
    const r = await fetch(document.querySelector('.gd-photo img')?.getAttribute('src') || '');
    const b = await createImageBitmap(await r.blob()); return [b.width, b.height];
  }).catch(() => null);
  ok('Foto hochgeladen (JPEG, Kante ≤ 1600)', size1 > 0 && Array.isArray(img) && Math.max(...img) <= 1600, JSON.stringify([size1, img]));

  // ---------------------------------------------------------------- Wiederöffnen ⇒ Vorbelegung; Foto ersetzen (photos_update)
  await P.click(`a.btn[href="#/spiel/${g}/ende"]`);
  await waitHash(P, `#/spiel/${g}/ende`);
  await P.waitForSelector('.rs-hero');
  const pressed = (sel) => P.$$eval(sel, (bs) => bs.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.v));
  const pre = {
    salt: await pressed('[data-pick="salt"]'), fun: await pressed('[data-pick="fun"]'), deck: await pressed('[data-pick="deckRating"]'),
    ds: await pressed(`[data-pick="dsalt"][data-deck="${krenko.id}"]`), potg: await pressed('[data-pick="potg"]'), w: await pressed('[data-pick="wincon"]'),
    txt: await P.inputValue('#rs-potg-text'), note: await P.inputValue('#rs-note'),
  };
  await P.waitForSelector('.rs-photo-img', { timeout: 8000 }).catch(() => {});
  ok('K4 Wiederöffnen zeigt Vorbelegung (Salz 3, Spaß 4, Deck 5, Krenko 4, POTG B + Text, Kampfschaden, Notiz, Foto)',
    JSON.stringify([pre.salt, pre.fun, pre.deck, pre.ds, pre.potg, pre.w]) === JSON.stringify([['3'], ['4'], ['5'], ['4'], [B], ['kampfschaden']])
    && pre.txt === 'Krenko-Kette in Runde 3' && pre.note === 'E2E Notiz P20' && (await P.locator('.rs-photo-img').count()) === 1, JSON.stringify(pre));
  await P.shot('p20-04-wiederoeffnen');
  // anderes Bild (größer, andere Farbe) ⇒ ersetzt dasselbe Objekt
  const other = await P.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(30,120,90)'; x.fillRect(0, 0, 2400, 1800); x.fillStyle = 'rgb(240,200,60)'; x.fillRect(300, 300, 1200, 900);
    const b = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92)); return [...new Uint8Array(await b.arrayBuffer())];
  });
  await P.setInputFiles('[data-photo] input[data-file]:not([capture])', { name: 'ersatz.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(other) });
  await P.waitForSelector('.rs-photo-img[src^="blob:"]');
  await P.click('[data-act="save"]');
  await waitHash(P, `#/partie/${g}`);
  const replacedOk = await toastIs(P, /^Gespeichert$/);
  const meta2 = await poll(META, metaArg, (v) => v && (v.etag !== meta1?.etag || v.at !== meta1?.at));
  ok('K4 Foto ersetzen klappt (upsert, Policy photos_update): kein „Foto nicht gespeichert“, Objekt geändert', replacedOk && meta2?.size > 0 && (meta2.etag !== meta1?.etag || meta2.at !== meta1?.at), JSON.stringify([meta1, meta2]));

  // ---------------------------------------------------------------- Kriterium 4: B bewertet über #/partie/<id> ⇒ „Bewerten“
  console.log('  Spielende: B (Luka Test) bewertet auf eigenem Gerät');
  const Q = await ctx(browser, 'F');
  await Q.setViewportSize({ width: 375, height: 812 });
  await Q.goto(BASE);
  await waitHash(Q, '#/login');
  await login(Q, mail('b'));
  await waitHash(Q, '#/start');
  await Q.goto(BASE + '#/partie/' + g);
  await Q.waitForSelector(`a.btn[href="#/spiel/${g}/ende"]`);
  await Q.click(`a.btn[href="#/spiel/${g}/ende"]`);
  await waitHash(Q, `#/spiel/${g}/ende`);
  await Q.waitForSelector('.rs-hero');
  ok('B: Deck-Salz nur für Tymna (eigenes Krenko fehlt, auch das von Jo geliehene)', (await Q.locator('[data-ds]').count()) === 1 && (await Q.locator(`[data-ds="${tymna.id}"]`).count()) === 1);
  ok('B: eigene Bewertung leer (fremde Bewertung von A nicht vorbelegt)', (await Q.locator('[data-pick="salt"][aria-pressed="true"], [data-pick="potg"][aria-pressed="true"]').count()) === 0);
  await Q.click('[data-pick="salt"][data-v="2"]');
  await Q.click('[data-pick="fun"][data-v="5"]');
  await Q.click(`[data-pick="saltiest"][data-deck="${tymna.id}"]`);
  await Q.click(`[data-pick="potg"][data-v="${A}"]`);
  await Q.shot('p20-05-b-bewertet');
  await Q.click('[data-act="save"]');
  await waitHash(Q, `#/partie/${g}`);
  const dbB = dbOn(Q);
  const r2 = await pollOn(dbB, Q)(REST, g, (v) => v?.pr?.length === 2 && v?.ds?.length === 2 && v?.pv?.length === 2);
  ok('K4 nach B: player_ratings 2 · deck_salt_ratings 2 · potg_votes 2', r2?.pr?.length === 2 && r2?.ds?.length === 2 && r2?.pv?.length === 2, JSON.stringify(r2 && [r2.pr, r2.ds, r2.pv]));
  ok('K4 B: Schnellwahl Salzigstes Deck ⇒ Tymna 5, Stimme für A ohne Text', r2?.ds?.some((x) => x.deck_id === tymna.id && x.salt === 5) && r2?.pv?.some((x) => x.voted_for === A && x.text === null), JSON.stringify(r2 && [r2.ds, r2.pv]));
  await Q.goto(BASE + `#/spiel/${g}/ende`);
  await Q.waitForSelector('.rs-hero');
  ok('K4 B: Wiederöffnen zeigt Bs Stand (Salz 2, Spaß 5, Tymna 5, POTG A)',
    JSON.stringify(await Q.$$eval('[data-pick][aria-pressed="true"]', (bs) => bs.map((b) => `${b.dataset.pick}:${b.dataset.v ?? b.dataset.deck}`).sort()))
    === JSON.stringify([`dsalt:5`, `fun:5`, `potg:${A}`, 'salt:2', 'wincon:kampfschaden'].sort()));
  await Q.shot('p20-06-b-wiederoeffnen');

  // ---------------------------------------------------------------- Startseite: Rangliste + Zuletzt gespielt mit dem Spiel
  await Q.goto(BASE + '#/start');
  await Q.waitForSelector(`[data-recent="${g}"]`, { timeout: 10000 }).catch(() => {});
  ok('Startseite (B): Spiel unter „Zuletzt gespielt“ + Rangliste', (await Q.locator(`[data-recent="${g}"]`).count()) === 1 && (await Q.locator('.home-top-row').count()) >= 1);
  await Q.shot('p20-07-startseite');
  ok('Keine JS-Fehler (B)', Q.errs.length === 0, Q.errs.join(' | '));
  console.log('    HTTP-Fehler F', JSON.stringify(Q.bad));
  ok('Keine HTTP-Fehler (B)', Q.bad.length === 0, JSON.stringify(Q.bad));
  await Q.context().close();

  // ---------------------------------------------------------------- Kriterium 7: rate_game-Fehler ⇒ Toast, Formular bleibt
  await P.goto(BASE + `#/spiel/${g}/ende`);
  await P.waitForSelector('.rs-hero');
  const failRoute = (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'Spiel ist nicht gewertet', details: null, hint: null }) });
  await P.route('**/rest/v1/rpc/rate_game', failRoute);
  await P.click('[data-pick="fun"][data-v="2"]');
  await P.click('[data-act="save"]');
  const errToast = await toastIs(P, /nicht gewertet/);
  ok('K7 rate_game-Fehler ⇒ Toast mit Text, Formular bleibt gefüllt, Seite bleibt', errToast && P.url().endsWith(`#/spiel/${g}/ende`)
    && (await P.getAttribute('[data-pick="fun"][data-v="2"]', 'aria-pressed')) === 'true' && (await P.inputValue('#rs-note')) === 'E2E Notiz P20');
  await P.shot('p20-08-fehler');
  await P.unroute('**/rest/v1/rpc/rate_game', failRoute);
  P.bad = P.bad.filter((x) => !/^400 .*\/rest\/v1\/rpc\/rate_game$/.test(x));
  const r3 = await db(REST, g);
  ok('K7 nach dem Fehler unverändert: As Spaß weiter 4', r3?.pr?.find((x) => x.member_id === A)?.fun === 4, JSON.stringify(r3?.pr));

  // ---------------------------------------------------------------- Aufräumen: Testfoto entfernen
  const rm = await db("const r = await sb.storage.from('game-photos').remove([a]); return { n: r.data?.length ?? 0, e: r.error?.message ?? null };", photo);
  ok('Aufräumen: Testfoto entfernt', rm?.n === 1 && !rm.e, JSON.stringify(rm));

  ok('Keine JS-Fehler (A)', P.errs.length === 0, P.errs.join(' | '));
  console.log('    HTTP-Fehler E', JSON.stringify(P.bad));
  ok('Keine HTTP-Fehler (A)', P.bad.length === 0, JSON.stringify(P.bad));
  await P.context().close();
}
