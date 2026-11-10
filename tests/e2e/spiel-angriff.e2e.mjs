// E2E Angriff per Ziehen (Spec P10, Kriterien 2–7 + Nachtrag 12:00 Touch, Bilder zu 1).
// Läuft alphabetisch NACH setup.e2e.mjs mit den Konten/Mitgliedern des Laufs:
//   A = mail('a') „Franco Test“ (Deck Tymna + Thrasios, Partner) · B = „Luka Test“ (Deck Krenko aus setup.e2e)
//   C = „Tim Echt“ · Jo = Platzhalter „Jo Test“ (aus setup.e2e). Legt KEIN Konto, KEIN Mitglied, KEIN Deck an.
// Das Spiel startet über den Store der App (RPC start_game, wie life.e2e) und wird am Ende verworfen.
// Gezogen wird mit der Maus (page.mouse) in Bildschirmkoordinaten; Touch über CDP (Input.dispatchTouchEvent).
import { ok, ctx, waitHash, login, mail } from './harness.mjs';

export default async function angriffE2e({ browser, base: BASE }) {
  console.log('\nAngriff: Anmelden als A (Franco Test)');
  const P = await ctx(browser, 'X');
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
  const poll = async (fn, arg, pred, ms = 12000) => {
    const end = Date.now() + ms; let v;
    do { v = await db(fn, arg); if (pred(v)) return v; await P.waitForTimeout(300); } while (Date.now() < end);
    return v;
  };

  // ---------------------------------------------------------------- Aufbau: 4 Spieler, Layout seiten
  const gid = await db('return state.groupId;');
  const mem = await db("const r = await sb.from('members').select('id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n)?.id;
  const A = byName('Franco Test'), B = byName('Luka Test'), C = byName('Tim Echt'), J = byName('Jo Test');
  ok('Gruppe hat A, B, C, Jo', !!(A && B && C && J), JSON.stringify(mem));
  const decks = await db("const q = await sb.from('decks').select('id, commander_name, partner_name').eq('archived', false); return q.data;");
  const tymna = decks.find((d) => /^Tymna/.test(d.commander_name));
  const krenko = decks.find((d) => /^Krenko/.test(d.commander_name)) || tymna;
  ok('Decks Tymna (Partner Thrasios) und Krenko vorhanden', !!tymna?.partner_name && !!krenko, JSON.stringify(decks));
  const deckOf = { [A]: tymna.id, [B]: krenko.id, [C]: tymna.id, [J]: tymna.id };
  const gameId = await db(`return createStore(sb).startGame({ groupId: a.gid, layout: 'seiten', startingLife: 40, firstSeat: 0,
      players: a.ids.map((id, i) => ({ memberId: id, deckId: a.decks[id], seat: i })) });`, { gid, ids: [A, B, C, J], decks: deckOf });
  ok('Spiel gestartet (4 Spieler, seiten)', typeof gameId === 'string' && gameId.length > 10, String(gameId));

  const field = (id) => `.lc-field[data-pid="${id}"]`;
  const lifeOf = async (id) => Number((await P.textContent(`${field(id)} [data-life]`)).trim());
  const lives = async () => Object.fromEntries(await Promise.all([A, B, C, J].map(async (id) => [id, await lifeOf(id)])));
  const center = async (sel) => { const bb = await P.locator(sel).first().boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
  const sheetGone = () => P.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  const closeSheet = async () => { await P.keyboard.press('Escape'); await sheetGone(); };
  const noSheet = async () => (await P.locator('.sheet-wrap').count()) === 0;
  const pause = () => P.waitForTimeout(450); // Tipps < 400 ms nach einem Ziehen zählen nicht
  /** Ziehen mit der Maus; hold(): Zwischenprüfung/Bild vor dem Loslassen. */
  const drag = async (from, to, hold) => {
    await P.mouse.move(from[0], from[1]); await P.mouse.down();
    await P.mouse.move(to[0], to[1], { steps: 14 });
    if (hold) await hold();
    await P.mouse.up();
  };
  const dragTo = async (fromId, toSel, hold) => { await pause(); await drag(await center(field(fromId)), await center(toSel), hold); };
  const openAttack = async (fromId, toSel, hold) => { await dragTo(fromId, toSel, hold); await P.waitForSelector('[data-sheet="attack"]'); };
  const preview = () => P.$$eval('[data-sheet="attack"] [data-pv]', (rs) => rs.map((r) => [r.dataset.pv, Number(r.querySelector('[data-to-life]')?.textContent)]));
  const menu = async (tab) => {
    if (!(await P.locator('[data-sheet="menu"]').count())) { await P.click('.lc-hub'); await P.waitForSelector('[data-sheet="menu"]'); }
    if (tab) await P.click(`[data-sheet="menu"] [data-m="tab"][data-t="${tab}"]`);
  };

  await P.goto(BASE + '#/spiel/' + gameId);
  await P.waitForSelector('.lc-field');
  ok('Lifecounter: 4 Felder, Mittelknopf data-pid="__all"', (await P.locator('.lc-field').count()) === 4 && (await P.locator('.lc-hub[data-pid="__all"]').count()) === 1);

  // ---------------------------------------------------------------- Kriterium 7a: Banner beim ersten Spiel
  ok('K7 erstes Spiel zeigt den Hinweis-Banner', await P.locator('.atk-banner').isVisible());
  await P.shot('p10-01-banner');

  // ---------------------------------------------------------------- Kriterium 5: Tippen bleibt Tippen
  const m = await center(`${field(A)} .lc-tap.minus`);
  await drag(m, [m[0] + 10, m[1]]);
  await P.waitForTimeout(150);
  ok('K5 Bewegung 10 px ⇒ Tipp −1 (A 39), kein Fenster', (await lifeOf(A)) === 39 && await noSheet(), String(await lifeOf(A)));
  await pause();
  await drag(m, [m[0], m[1] + 30]);
  await P.waitForTimeout(150);
  ok('K5 Bewegung 30 px im eigenen Feld ⇒ nichts (A 39, kein Fenster)', (await lifeOf(A)) === 39 && await noSheet(), String(await lifeOf(A)));
  ok('K7 Banner bleibt nach erfolglosem Ziehen', await P.locator('.atk-banner').isVisible());

  // ---------------------------------------------------------------- Kriterium 6 + 4: gedrehte Felder, Vorschau = Ergebnis
  // seiten/4: A (1,1) 90° · B (2,1) −90° · C (2,2) −90° · Jo (1,2) 90° ⇒ Jo (links unten) auf B (rechts oben)
  await openAttack(J, field(B), async () => {
    ok('Ziehen: Zielfeld B rot gerahmt, Zielfernrohr eingerastet, Startfeld gedimmt',
      (await P.locator(`${field(B)}.atk-over`).count()) === 1 && (await P.locator('.atk-layer.locked').count()) === 1 && (await P.locator(`${field(J)}.atk-from`).count()) === 1);
    await P.shot('p10-02-ziehen-ziel');
  });
  ok('K6 gedrehtes Feld links ⇒ rechts trifft B (Kopf „Jo Test → Luka Test“)',
    (await P.textContent('.atk-h')).includes('Jo Test') && (await P.textContent('.atk-h [data-head]')).trim() === 'Luka Test', await P.textContent('.atk-h'));
  ok('K7 Banner nach erstem erfolgreichen Ziehen weg', (await P.locator('.atk-banner').count()) === 0);
  await P.click('[data-sheet="attack"] [data-a="quick"][data-v="5"]');
  const pv6 = await preview();
  ok('Fenster: „5 Schaden eintragen“', (await P.textContent('[data-a="apply"]')).trim() === '5 Schaden eintragen', await P.textContent('[data-a="apply"]'));
  await P.click('[data-sheet="attack"] [data-a="apply"]');
  await sheetGone();
  ok('K4 Vorschau = Feldwert (B 35)', pv6.length === 1 && pv6[0][0] === B && pv6[0][1] === (await lifeOf(B)) && pv6[0][1] === 35, JSON.stringify(pv6));

  // ---------------------------------------------------------------- Kriterium 3 + 4: ALLE + Lifelink, Rückgängig
  const before3 = await lives();
  await openAttack(A, '.lc-hub', async () => {
    ok('Ziehen auf den Mittelknopf ⇒ „ALLE“ rot', (await P.locator('.lc-hub.atk-drag.atk-over .atk-alle').isVisible()) && (await P.textContent('.lc-hub .atk-alle')).includes('ALLE'));
    await P.shot('p10-03-ziehen-alle');
  });
  const tgts = await P.$$eval('[data-sheet="attack"] [data-a="tgt"][aria-pressed="true"]', (bs) => bs.map((b) => b.dataset.id).sort());
  ok('K3 Fenster mit allen lebenden Gegnern („Alle Gegner“)', JSON.stringify(tgts) === JSON.stringify([B, C, J].sort()) && (await P.textContent('.atk-h [data-head]')).trim() === 'Alle Gegner', JSON.stringify(tgts));
  await P.click('[data-sheet="attack"] [data-a="amt"][data-v="1"]');
  await P.click('[data-sheet="attack"] [data-a="amt"][data-v="1"]');
  await P.click('[data-sheet="attack"] [data-a="link"]');
  const pv3 = await preview();
  const gain3 = Number(await P.textContent('[data-sheet="attack"] [data-pv-gain] [data-to-life]'));
  ok('Knopf „3 Schaden an 3 Gegner eintragen“', (await P.textContent('[data-a="apply"]')).trim() === '3 Schaden an 3 Gegner eintragen');
  await P.shot('p10-04-fenster-alle-lifelink');
  await P.click('[data-sheet="attack"] [data-a="apply"]');
  await sheetGone();
  const after3 = await lives();
  ok('K3 jeder Gegner −3, A + 3 × 3', after3[B] === before3[B] - 3 && after3[C] === before3[C] - 3 && after3[J] === before3[J] - 3 && after3[A] === before3[A] + 9,
    JSON.stringify([before3, after3]));
  ok('K4 Vorschau = Feldwerte je Ziel (+ Lifelink)', pv3.length === 3 && pv3.every(([id, v]) => after3[id] === v) && gain3 === after3[A], JSON.stringify([pv3, gain3, after3]));
  await menu('log');
  await P.click('[data-sheet="menu"] [data-m="undo"]');
  await closeSheet();
  ok('K3 ein Rückgängig ⇒ alle Werte wie vorher', JSON.stringify(await lives()) === JSON.stringify(before3), JSON.stringify([before3, await lives()]));

  // ---------------------------------------------------------------- Bilder zu 1: Commander mit Partner, Gift
  await openAttack(A, field(C));
  const kindsTxt = await P.$$eval('[data-sheet="attack"] [data-a="kind"]', (bs) => bs.map((b) => [b.dataset.k, b.textContent.trim()]));
  ok('Partner: Arten Schaden · Tymna · Thrasios · Gift (cmd/cmd2)', kindsTxt.map((k) => k[0]).join() === 'damage,cmd,cmd2,poison' && /Tymna/.test(kindsTxt[1][1]) && /Thrasios/.test(kindsTxt[2][1]), JSON.stringify(kindsTxt));
  await P.click('[data-sheet="attack"] [data-a="kind"][data-k="cmd2"]');
  ok('Commander-Vorschau mit Balken „/ 21“ (Thrasios)', /Thrasios/.test(await P.textContent('[data-sheet="attack"] [data-pv]')) && /1 \/ 21/.test(await P.textContent('[data-sheet="attack"] [data-to-cmd]')));
  await P.shot('p10-05-fenster-commander-partner');
  await P.click('[data-sheet="attack"] [data-a="kind"][data-k="poison"]');
  ok('Gift: Lifelink ausgeblendet, „/10“', (await P.locator('[data-sheet="attack"] [data-a="link"]').count()) === 0 && /\/10/.test(await P.textContent('[data-sheet="attack"] [data-to-poison]')));
  await P.shot('p10-06-fenster-gift');
  for (const look of ['nacht', 'arktis', 'lachs']) {
    await P.evaluate((l) => { document.documentElement.dataset.theme = l; }, look);
    await P.click('[data-sheet="attack"] [data-a="kind"][data-k="cmd"]');
    await P.shot(`p10-07-fenster-${look}`);
  }
  await P.evaluate(() => { document.documentElement.dataset.theme = 'nacht'; });
  await closeSheet();
  ok('Abbrechen ⇒ nichts eingetragen', JSON.stringify(await lives()) === JSON.stringify(before3));

  // ---------------------------------------------------------------- Kriterium 2: Commander-Tod mit Verursacher
  for (let i = 0; i < 3; i++) {
    await openAttack(A, field(B));
    await P.click('[data-sheet="attack"] [data-a="kind"][data-k="cmd"]');
    for (let k = 0; k < 6; k++) await P.click('[data-sheet="attack"] [data-a="amt"][data-v="1"]');
    ok(`K2 Angriff ${i + 1}: „7 Commander-Schaden eintragen“`, (await P.textContent('[data-a="apply"]')).trim() === '7 Commander-Schaden eintragen');
    if (i === 2) {
      ok('K2 Vorschau tödlich: 21 / 21 und Zeile rot', (await P.locator(`[data-pv="${B}"].lethal [data-to-cmd="21"].dead`).count()) === 1 && (await P.locator(`[data-pv="${B}"] [data-to-life].dead`).count()) === 1);
      await P.shot('p10-08-fenster-toedlich');
    }
    await P.click('[data-sheet="attack"] [data-a="apply"]');
    if (i < 2) await sheetGone();
  }
  await P.waitForSelector('[data-sheet="ko"]');
  ok('K2 K.O.-Fenster mit „Ausscheiden“ (Verursacher bekannt)', (await P.locator('[data-sheet="ko"] [data-ko="out"]').count()) === 1 && (await P.locator('[data-sheet="ko"] [data-ko="ask"]').count()) === 0);
  await P.shot('p10-09-ko-ausscheiden');
  await P.click('[data-sheet="ko"] [data-ko="out"]');
  await sheetGone();
  ok('K2 B raus (Platz-Plakette, durch Franco Test)', /Platz 4/.test(await P.textContent(`${field(B)} .lc-plaque`)) && /Franco Test/.test(await P.textContent(`${field(B)} .lc-plaque`)), await P.textContent(`${field(B)} .lc-plaque`));
  const elim = await poll("const r = await sb.from('game_events').select('type, source, target').eq('game_id', a).eq('type', 'eliminate'); return r.data;", gameId, (r) => r?.length === 1);
  ok('K2 game_events: eliminate target = B, source = A', elim?.length === 1 && elim[0].target === B && elim[0].source === A, JSON.stringify(elim));
  const dm = await poll("const r = await sb.from('v_damage_matrix').select('source, target, damage, commander_damage').eq('game_id', a); return r.data;", gameId,
    (r) => r?.find((x) => x.source === A && x.target === B)?.commander_damage === 21);
  const ab = dm?.find((x) => x.source === A && x.target === B);
  ok('K2 v_damage_matrix: A→B commander_damage 21 (rückgängig gemachter ALLE-Angriff zählt nicht)', ab?.commander_damage === 21 && ab?.damage === 21, JSON.stringify(dm));
  const atkEv = await db("const r = await sb.from('game_events').select('type, payload').eq('game_id', a).eq('type', 'cmd_damage'); return r.data;", gameId);
  ok('K2 je Angriff eine Aktion (3 cmd_damage, 3 verschiedene act)', atkEv?.length === 3 && new Set(atkEv.map((e) => e.payload?.act)).size === 3, JSON.stringify(atkEv));

  // ---------------------------------------------------------------- Negativraum: ausgeschiedenes Feld
  await dragTo(B, field(C));
  await P.waitForTimeout(200);
  ok('Ziehen vom ausgeschiedenen Feld ⇒ nichts', await noSheet() && (await P.locator('.atk-layer').count()) === 0);
  await dragTo(A, field(B));
  await P.waitForTimeout(200);
  ok('Ziehen auf ein ausgeschiedenes Feld ⇒ nichts', await noSheet());

  // ---------------------------------------------------------------- Kriterium 7b: nach Reload kein Banner
  await P.reload();
  await P.waitForSelector('.lc-field');
  await P.waitForTimeout(400);
  ok('K7 nach Reload kein Banner', (await P.locator('.atk-banner').count()) === 0);

  // ---------------------------------------------------------------- Nachtrag 12:00: Touch bei 375 px, Tisch scrollt nie
  await P.setViewportSize({ width: 375, height: 812 });
  await P.waitForTimeout(300);
  const cdp = await P.context().newCDPSession(P);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const tA = await center(field(A)), tC = await center(field(C));
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', tA[0], tA[1]);
  for (let i = 1; i <= 14; i++) await touch('touchMove', tA[0] + ((tC[0] - tA[0]) * i) / 14, tA[1] + ((tC[1] - tA[1]) * i) / 14);
  const scroll = await P.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]);
  await touch('touchEnd');
  await P.waitForSelector('[data-sheet="attack"]', { timeout: 5000 }).catch(() => {});
  ok('Touch 375 px: scrollY 0 und scrollTop 0 während des Ziehens', scroll[0] === 0 && scroll[1] === 0, JSON.stringify(scroll));
  ok('Touch 375 px: Angriffsfenster A → Tim Echt', (await P.locator('[data-sheet="attack"]').count()) === 1 && (await P.textContent('.atk-h [data-head]')).trim() === 'Tim Echt');
  await P.shot('p10-10-touch-375');
  await closeSheet();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await P.setViewportSize({ width: 390, height: 844 });
  await menu('log');
  const logScroll = await P.$eval('.lc-log', (e) => getComputedStyle(e).overflowY);
  ok('Verlauf (.lc-log) bleibt scrollbar', ['auto', 'scroll'].includes(logScroll), logScroll);

  // ---------------------------------------------------------------- Aufräumen: Spiel verwerfen
  await menu();
  await P.click('[data-sheet="menu"] [data-m="end"]');
  await P.waitForSelector('[data-sheet="end"]');
  await P.click('[data-sheet="end"] [data-e="aborted"]');
  await waitHash(P, '#/start');
  const st = await poll("const r = await sb.from('games').select('status').eq('id', a).single(); return r.data?.status;", gameId, (v) => v === 'aborted');
  ok('Spiel verworfen (aborted)', st === 'aborted', st);

  ok('Keine JS-Fehler im Angriff-Lauf', P.errs.length === 0, P.errs.join(' | '));
  console.log('    HTTP-Fehler X', JSON.stringify(P.bad));
  ok('Keine HTTP-Fehler im Angriff-Lauf', P.bad.length === 0, JSON.stringify(P.bad));
  await P.context().close();
}
